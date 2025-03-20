#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import path from "path";
import { envConfig } from "../config/envConfig.js";
import { BaseErrorCode, McpError } from "../types-global/errors.js";
import { ErrorHandler } from "../utils/errorHandler.js";
import { idGenerator } from "../utils/idGenerator.js";
import { logger } from "../utils/logger.js";
import { createRequestContext } from "../utils/requestContext.js";
import { configureContext, sanitizeInput } from "../utils/security.js";

// Import tool registrations
import { registerEchoTool } from "./tools/echoTool/index.js";

// Import resource registrations
import { registerEchoResource } from "./resources/echoResource/index.js";

// Maximum file size for package.json (5MB) to prevent potential DoS
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Load package information directly from package.json
 * 
 * @returns A promise resolving to an object with the package name and version
 */
const loadPackageInfo = async (): Promise<{ name: string; version: string }> => {
  return await ErrorHandler.tryCatch(
    async () => {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const safePath = sanitizeInput.path(pkgPath);
      
      // Get file stats to check size before reading
      const stats = await fs.stat(safePath);
      
      // Check file size to prevent DoS attacks
      if (stats.size > MAX_FILE_SIZE) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `package.json file is too large (${stats.size} bytes)`,
          { path: safePath, maxSize: MAX_FILE_SIZE }
        );
      }
      
      const pkgContent = await fs.readFile(safePath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      
      if (!pkg.name || typeof pkg.name !== 'string' || 
          !pkg.version || typeof pkg.version !== 'string') {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR, 
          'Invalid package.json: missing name or version',
          { path: safePath }
        );
      }
      
      return {
        name: pkg.name,
        version: pkg.version
      };
    },
    {
      operation: 'LoadPackageInfo',
      errorCode: BaseErrorCode.VALIDATION_ERROR,
      rethrow: false,
      includeStack: true,
      errorMapper: (error) => {
        if (error instanceof SyntaxError) {
          return new McpError(
            BaseErrorCode.VALIDATION_ERROR,
            `Failed to parse package.json: ${error.message}`,
            { errorType: 'SyntaxError' }
          );
        }
        return new McpError(
          BaseErrorCode.INTERNAL_ERROR,
          `Failed to load package info: ${error instanceof Error ? error.message : String(error)}`,
          { errorType: error instanceof Error ? error.name : typeof error }
        );
      }
    }
  ).catch(() => {
    // If we can't load package.json, use defaults
    return {
      name: "mcp-template-server",
      version: "1.0.0"
    };
  });
};

/**
 * Server state management interface
 */
export interface ServerState {
  status: 'initializing' | 'running' | 'error' | 'degraded' | 'shutting_down' | 'shutdown';
  startTime: Date;
  lastHealthCheck: Date;
  activeOperations: Map<string, { operation: string; startTime: Date }>;
  errors: Array<{ timestamp: Date; message: string; code?: string }>;
  registeredTools: Set<string>;
  registeredResources: Set<string>;
  failedRegistrations: Array<{
    type: 'tool' | 'resource';
    name: string;
    error: any;
    attempts: number;
  }>;
  requiredTools: Set<string>;
  requiredResources: Set<string>;
}

/**
 * Server event emitter for lifecycle events
 */
class ServerEvents extends EventEmitter {
  constructor() {
    super();
  }

  // Type-safe event emitters
  emitStateChange(oldState: ServerState['status'], newState: ServerState['status']) {
    this.emit('stateChange', oldState, newState);
    this.emit(`state:${newState}`, oldState);
  }
}

/**
 * Create and initialize an MCP server instance with all tools and resources
 * 
 * This function configures the MCP server with security settings, tools, and resources.
 * It connects the server to a transport (currently stdio) and returns the initialized
 * server instance.
 * 
 * @returns A promise that resolves to the initialized McpServer instance
 * @throws {McpError} If the server fails to initialize
 */
export const createMcpServer = async () => {
  // Initialize server variable outside try/catch
  let server: McpServer | undefined;
  
  // Maximum registration retry attempts
  const MAX_REGISTRATION_RETRIES = 3;
  
  // Create a unique server instance ID
  const serverId = idGenerator.generateRandomString(8);
  
  // Initialize server state for tracking
  const serverState: ServerState = {
    status: 'initializing',
    startTime: new Date(),
    lastHealthCheck: new Date(),
    activeOperations: new Map(),
    errors: [],
    registeredTools: new Set(),
    registeredResources: new Set(),
    failedRegistrations: [],
    requiredTools: new Set(['echo_message']), // Define tools that are required for the server to function properly
    requiredResources: new Set(['echo-resource']) // Define resources that are required for the server to function properly
  };

  // Create operation context
  const serverContext = createRequestContext({
    operation: 'ServerStartup',
    component: 'McpServer',
    serverId
  });

  // Create server-specific logger with context
  const serverLogger = logger.createChildLogger({
    service: 'MCPServer',
    requestId: serverContext.requestId,
    serverId,
    environment: envConfig().environment
  });

  // Create server events emitter
  const serverEvents = new ServerEvents();
  
  // Monitor state changes
  serverEvents.on('stateChange', (oldState, newState) => {
    serverLogger.info(`Server state changed from ${oldState} to ${newState}`, { 
      previousState: oldState, 
      newState 
    });
  });
  
  serverLogger.info("Initializing server...");
  
  const timers: Array<NodeJS.Timeout> = [];
  
  return await ErrorHandler.tryCatch(
    async () => {
      // Load package info asynchronously
      const packageInfo = await loadPackageInfo();
      
      // Update logger with package info
      serverLogger.info("Loaded package info", {
        name: packageInfo.name,
        version: packageInfo.version
      });
    
      // Rate limiting configuration
      const rateLimitSettings = {
        windowMs: envConfig().rateLimit.windowMs || 60000,
        maxRequests: envConfig().rateLimit.maxRequests || 100
      };
      
      // Configure context settings
      const contextConfig = configureContext({
        // Any future non-auth context settings can go here
      });

      // Create the MCP server instance
      server = new McpServer({
        name: packageInfo.name,
        version: packageInfo.version
      });
      
      // Set up error handling
      process.on('uncaughtException', (error) => {
        serverState.status = 'error';
        serverState.errors.push({
          timestamp: new Date(),
          message: error.message,
          code: error instanceof McpError ? error.code : 'UNCAUGHT_EXCEPTION'
        });
        
        ErrorHandler.handleError(error, {
          operation: 'UncaughtException',
          context: serverContext,
          critical: true
        });
      });
      
      process.on('unhandledRejection', (reason) => {
        serverState.status = 'error';
        serverState.errors.push({
          timestamp: new Date(),
          message: reason instanceof Error ? reason.message : String(reason),
          code: reason instanceof McpError ? reason.code : 'UNHANDLED_REJECTION'
        });
        
        ErrorHandler.handleError(reason, {
          operation: 'UnhandledRejection',
          context: serverContext,
          critical: true
        });
      });
      
      /**
       * Update server status based on current state
       */
      const updateServerStatus = () => {
        const requiredToolsMet = Array.from(serverState.requiredTools)
          .every(tool => serverState.registeredTools.has(tool));
        const requiredResourcesMet = Array.from(serverState.requiredResources)
          .every(resource => serverState.registeredResources.has(resource));
        
        const oldStatus = serverState.status;
        // Only update if not in terminal states
        if (!['shutdown', 'shutting_down'].includes(oldStatus)) {
          const newStatus = requiredToolsMet && requiredResourcesMet ? 'running' : 'degraded';
          if (oldStatus !== newStatus) {
            serverState.status = newStatus;
            serverEvents.emitStateChange(oldStatus, newStatus);
          }
        }
      };
      
      /**
       * Health check function
       */
      function runHealthCheck() {
        return ErrorHandler.tryCatch(
          async () => {
            serverState.lastHealthCheck = new Date();
            
            // Check for stalled operations (longer than 5 minutes)
            const now = Date.now();
            for (const [opId, opInfo] of serverState.activeOperations.entries()) {
              const opRuntime = now - opInfo.startTime.getTime();
              if (opRuntime > 300000) { // 5 minutes
                serverLogger.warn(`Operation ${opInfo.operation} (${opId}) has been running for over 5 minutes`, {
                  operation: opInfo.operation,
                  startTime: opInfo.startTime,
                  runtime: opRuntime
                });
              }
            }
            
            serverLogger.debug("Server health check", { 
              status: serverState.status,
              uptime: (now - serverState.startTime.getTime()) / 1000,
              activeOperations: serverState.activeOperations.size,
              errors: serverState.errors.length
            });
          },
          {
            operation: 'HealthCheck',
            context: serverContext
          }
        );
      }
      
      // Create interval that won't prevent process exit
      const healthCheckInterval = setInterval(() => runHealthCheck(), 60000); // Every minute
      healthCheckInterval.unref(); // Ensures this won't prevent process exit
      
      // Track the interval for cleanup
      timers.push(healthCheckInterval);
      
      /**
       * Cleanup function to handle graceful shutdown
       */
      const cleanup = async () => {
        return await ErrorHandler.tryCatch(
          async () => {
            // Set state to shutting_down if not already
            if (serverState.status !== 'shutting_down' && serverState.status !== 'shutdown') {
              const oldStatus = serverState.status;
              serverState.status = 'shutting_down';
              serverEvents.emitStateChange(oldStatus, 'shutting_down');
            }
            
            // Clean up all timers
            for (const timer of timers) {
              clearInterval(timer);
              clearTimeout(timer);
            }
            
            // Wait for active operations to complete (with timeout)
            if (serverState.activeOperations.size > 0) {
              serverLogger.info(`Waiting for ${serverState.activeOperations.size} active operations to complete...`);
              
              // In a real implementation, you might want to wait for operations to complete
              // or implement a timeout mechanism
            }
            
            // Close the server
            if (server) {
              await server.close();
              serverLogger.info("Server closed successfully");
            }
            
            // Set final state
            serverState.status = 'shutdown';
            
            return true;
          },
          {
            operation: 'Cleanup',
            context: serverContext
          }
        );
      };
      
      // Track operation for cleanup on shutdown
      process.on('SIGINT', async () => {
        serverLogger.info("Shutting down server due to SIGINT signal...");
        await cleanup();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        serverLogger.info("Shutting down server due to SIGTERM signal...");
        await cleanup();
        process.exit(0);
      });

      // Register tools and resources in parallel with error handling
      type RegistrationResult = {
        success: boolean;
        type: 'tool' | 'resource';
        name: string;
        error?: any;
      };
      
      const registerComponent = async (
        type: 'tool' | 'resource',
        name: string,
        registerFn: () => Promise<void>
      ): Promise<RegistrationResult> => {
        try {
          await ErrorHandler.tryCatch(
            async () => await registerFn(),
            {
              operation: `Register${type === 'tool' ? 'Tool' : 'Resource'}`,
              context: { ...serverContext, componentName: name },
              errorCode: BaseErrorCode.INTERNAL_ERROR
            }
          );
          
          // Update state based on component type
          if (type === 'tool') {
            serverState.registeredTools.add(name);
          } else {
            serverState.registeredResources.add(name);
          }
          
          return { success: true, type, name };
        } catch (error) {
          return { success: false, type, name, error };
        }
      };
      
      // Register components with proper error handling
      const registrationPromises: Promise<RegistrationResult>[] = [
        registerComponent('tool', 'echo_message', () => registerEchoTool(server!)),
        registerComponent('resource', 'echo-resource', () => registerEchoResource(server!))
      ];
      
      const registrationResults = await Promise.allSettled(registrationPromises);
      
      // Process the results to find failed registrations
      const failedRegistrations: Array<RegistrationResult & { attempts?: number }> = [];
      
      registrationResults.forEach(result => {
        if (result.status === 'rejected') {
          failedRegistrations.push({ 
            success: false, 
            type: 'unknown' as 'tool' | 'resource', 
            name: 'unknown', 
            error: result.reason 
          });
        } else if (!result.value.success) {
          failedRegistrations.push(result.value);
        }
      });
      
      // Process failed registrations
      if (failedRegistrations.length > 0) {
        serverLogger.warn(`${failedRegistrations.length} registrations failed initially`, {
          failedComponents: failedRegistrations.map(f => `${f.type}:${f.name}`) 
        });
        
        // Track failed registrations for potential retry
        for (const failure of failedRegistrations) {
          serverState.failedRegistrations.push({
            type: failure.type,
            name: failure.name,
            error: failure.error || new Error('Unknown error during registration'),
            attempts: 1
          });
        }
        
        // Update server status based on failures
        updateServerStatus();
        
        // Set up retry mechanism for failed registrations
        if (serverState.failedRegistrations.length > 0) {
          const retryInterval = setInterval(async () => {
            await ErrorHandler.tryCatch(
              async () => {
                if (serverState.failedRegistrations.length === 0) {
                  clearInterval(retryInterval);
                  return;
                }
                
                const retryable = serverState.failedRegistrations.filter(f => f.attempts < MAX_REGISTRATION_RETRIES);
                if (retryable.length === 0) {
                  serverLogger.warn("Maximum retry attempts reached for all failed registrations");
                  clearInterval(retryInterval);
                  return;
                }
                
                serverLogger.info(`Attempting to retry ${retryable.length} failed registrations...`);
                
                // Retry each component
                for (let i = 0; i < retryable.length; i++) {
                  const failedReg = { ...retryable[i] }; // Get a copy to avoid mutation issues
                  
                  try {
                    if (failedReg.type === 'tool') {
                      // Retry tool registration
                      await registerEchoTool(server!);
                      serverState.registeredTools.add(failedReg.name);
                      
                      // Remove from failed list
                      serverState.failedRegistrations = serverState.failedRegistrations.filter(
                        f => !(f.type === 'tool' && f.name === failedReg.name)
                      );
                      
                      serverLogger.info(`Successfully retried registration for tool: ${failedReg.name}`);
                    } else if (failedReg.type === 'resource') {
                      // Retry resource registration
                      await registerEchoResource(server!);
                      serverState.registeredResources.add(failedReg.name);
                      
                      // Remove from failed list
                      serverState.failedRegistrations = serverState.failedRegistrations.filter(
                        f => !(f.type === 'resource' && f.name === failedReg.name)
                      );
                      
                      serverLogger.info(`Successfully retried registration for resource: ${failedReg.name}`);
                    }
                  } catch (error) {
                    // Increment retry count
                    const failedItem = serverState.failedRegistrations.find(
                      f => f.type === failedReg.type && f.name === failedReg.name
                    );
                    
                    if (failedItem) {
                      failedItem.attempts++;
                      failedItem.error = error;
                    }
                    
                    serverLogger.error(`Retry failed for ${failedReg.type} ${failedReg.name}`, { 
                      error: error instanceof Error ? error.message : String(error),
                      attemptNumber: failedItem?.attempts
                    });
                  }
                }
                
                // After retry attempts, update server status
                updateServerStatus();
              },
              {
                operation: 'RetryRegistrations',
                context: serverContext
              }
            );
          }, 30000); // Retry every 30 seconds
          
          // Ensure interval doesn't prevent process exit
          retryInterval.unref();
          // Track the interval for cleanup
          timers.push(retryInterval);
        }
      }

      // Connect using stdio transport
      await server.connect(new StdioServerTransport());
      
      // Update server state
      const oldStatus = serverState.status;
      serverState.status = 'running';
      serverEvents.emitStateChange(oldStatus, 'running');
      
      serverLogger.info("Server started and connected successfully", {
        tools: Array.from(serverState.registeredTools),
        resources: Array.from(serverState.registeredResources)
      });

      // Add event listener for graceful shutdown
      serverEvents.on('state:shutting_down', () => cleanup());

      // Run initial health check
      await runHealthCheck();

      return server;
    },
    {
      operation: 'CreateMcpServer',
      context: serverContext,
      critical: true,
      errorMapper: (error) => new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to initialize MCP server: ${error instanceof Error ? error.message : String(error)}`,
        { 
          serverState: serverState.status,
          startTime: serverState.startTime,
          registeredTools: Array.from(serverState.registeredTools),
          registeredResources: Array.from(serverState.registeredResources)
        }
      )
    }
  ).catch((error) => {
    // Clean up timers
    for (const timer of timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    
    // Attempt to close server
    if (server) {
      try {
        server.close();
      } catch (closeError) {
        // Already in error state, just log
        serverLogger.debug("Error while closing server during error recovery", {
          error: closeError instanceof Error ? closeError.message : String(closeError)
        });
      }
    }
    
    // Re-throw to communicate error to caller
    throw error;
  });
};