#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import path from "path";
import { config, environment } from "../config/index.js"; 
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
  const operationContext = { operation: 'LoadPackageInfo' };
  return await ErrorHandler.tryCatch(
    async () => {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const safePath = sanitizeInput.path(pkgPath);
      
      logger.debug("Attempting to load package.json", { ...operationContext, path: safePath });

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
      
      logger.info("Successfully loaded package info", { ...operationContext, name: pkg.name, version: pkg.version });
      return {
        name: pkg.name,
        version: pkg.version
      };
    },
    {
      operation: 'LoadPackageInfo', // Keep operation name consistent
      context: operationContext, // Pass context
      errorCode: BaseErrorCode.VALIDATION_ERROR, // Default error code if not mapped
      rethrow: false, // Allow fallback
      includeStack: true,
      errorMapper: (error) => {
        if (error instanceof SyntaxError) {
          return new McpError(
            BaseErrorCode.VALIDATION_ERROR,
            `Failed to parse package.json: ${error.message}`,
            { errorType: 'SyntaxError' }
          );
        }
        // Let ErrorHandler handle logging for other errors
        return new McpError(
          BaseErrorCode.INTERNAL_ERROR,
          `Failed to load package info: ${error instanceof Error ? error.message : String(error)}`,
          { errorType: error instanceof Error ? error.name : typeof error }
        );
      }
    }
  ).catch((error) => { // Catch is only needed if rethrow is false and we want a fallback
    // Safely access error message
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to load package.json, using defaults.", { ...operationContext, error: errorMessage });
    // If we can't load package.json, use defaults from config if available
    return {
      name: config.mcpServerName || "mcp-template-server", 
      version: config.mcpServerVersion || "1.0.0"
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
    requiredTools: new Set(['echo_message']), // Define tools required for 'running' state
    requiredResources: new Set(['echo-resource']) // Define resources required for 'running' state
  };

  // Create base context for server operations
  const serverBaseContext = {
    service: 'MCPServer',
    serverId,
    environment: environment // Use imported environment
  };

  // Create server events emitter
  const serverEvents = new ServerEvents();
  
  // Monitor state changes
  serverEvents.on('stateChange', (oldState, newState) => {
    logger.info(`Server state changed from ${oldState} to ${newState}`, { 
      ...serverBaseContext,
      previousState: oldState, 
      newState 
    });
  });
  
  logger.info("Initializing server...", serverBaseContext);
  
  const timers: Array<NodeJS.Timeout> = [];
  
  return await ErrorHandler.tryCatch(
    async () => {
      // Load package info asynchronously
      const packageInfo = await loadPackageInfo();
      
      // Update base context with package info
      const serverContext = { ...serverBaseContext, appName: packageInfo.name, appVersion: packageInfo.version };
      
      logger.info("Loaded package info", {
        ...serverContext, // Log with full context now
        name: packageInfo.name,
        version: packageInfo.version
      });
    
      // Removed rate limiting logic - add back if needed and defined in config
      
      // Configure context settings (placeholder)
      const contextConfig = configureContext({
        // Any future non-auth context settings can go here
      });

      // Create the MCP server instance
      server = new McpServer({
        name: packageInfo.name,
        version: packageInfo.version
      });
      
      // Set up error handling for the process
      process.on('uncaughtException', (error) => {
        const oldStatus = serverState.status;
        serverState.status = 'error';
        serverEvents.emitStateChange(oldStatus, 'error');
        serverState.errors.push({
          timestamp: new Date(),
          message: error.message, // error is guaranteed to be Error here
          code: error instanceof McpError ? error.code : 'UNCAUGHT_EXCEPTION'
        });
        
        ErrorHandler.handleError(error, {
          operation: 'UncaughtException',
          context: serverContext,
          critical: true
        });
        // Consider initiating shutdown here if appropriate
      });
      
      process.on('unhandledRejection', (reason) => {
        const oldStatus = serverState.status;
        serverState.status = 'error';
        serverEvents.emitStateChange(oldStatus, 'error');
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
         // Consider initiating shutdown here if appropriate
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
        if (!['shutdown', 'shutting_down', 'error'].includes(oldStatus)) {
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
        const healthCheckContext = { ...serverContext, operation: 'HealthCheck' };
        return ErrorHandler.tryCatch(
          async () => {
            serverState.lastHealthCheck = new Date();
            
            // Check for stalled operations (longer than 5 minutes)
            const now = Date.now();
            for (const [opId, opInfo] of serverState.activeOperations.entries()) {
              const opRuntime = now - opInfo.startTime.getTime();
              if (opRuntime > 300000) { // 5 minutes
                logger.warn(`Operation ${opInfo.operation} (${opId}) has been running for over 5 minutes`, {
                  ...healthCheckContext,
                  operationId: opId,
                  stalledOperation: opInfo.operation,
                  startTime: opInfo.startTime,
                  runtimeMs: opRuntime
                });
              }
            }
            
            logger.debug("Server health check", { 
              ...healthCheckContext,
              status: serverState.status,
              uptimeSeconds: (now - serverState.startTime.getTime()) / 1000,
              activeOperationsCount: serverState.activeOperations.size,
              errorCount: serverState.errors.length
            });
          },
          {
            operation: 'HealthCheck', // Keep operation name consistent
            context: healthCheckContext // Pass context
          }
        );
      }
      
      // Create interval that won't prevent process exit
      const healthCheckInterval = setInterval(() => runHealthCheck(), 60000); // Every minute
      healthCheckInterval.unref(); // Ensures this won't prevent process exit
      timers.push(healthCheckInterval); // Track for cleanup
      
      /**
       * Cleanup function to handle graceful shutdown
       */
      const cleanup = async () => {
        const cleanupContext = { ...serverContext, operation: 'Cleanup' };
        return await ErrorHandler.tryCatch(
          async () => {
            // Set state to shutting_down if not already terminal
            if (!['shutting_down', 'shutdown'].includes(serverState.status)) {
              const oldStatus = serverState.status;
              serverState.status = 'shutting_down';
              serverEvents.emitStateChange(oldStatus, 'shutting_down');
            }
            
            logger.info("Starting server cleanup...", cleanupContext);

            // Clean up all timers
            for (const timer of timers) {
              clearInterval(timer);
              clearTimeout(timer);
            }
            timers.length = 0; // Clear the array
            
            // Wait for active operations to complete (with timeout) - Placeholder
            if (serverState.activeOperations.size > 0) {
              logger.info(`Waiting for ${serverState.activeOperations.size} active operations to complete...`, cleanupContext);
              // In a real implementation, add wait logic or timeout
            }
            
            // Close the server
            if (server) {
              await server.close();
              logger.info("Server closed successfully", cleanupContext);
            }
            
            // Set final state
            const finalOldStatus = serverState.status;
            serverState.status = 'shutdown';
            if (finalOldStatus !== 'shutdown') {
              serverEvents.emitStateChange(finalOldStatus, 'shutdown');
            }
            
            logger.info("Server cleanup finished.", cleanupContext);
            return true;
          },
          {
            operation: 'Cleanup', // Keep operation name consistent
            context: cleanupContext // Pass context
          }
        );
      };
      
      // Track operation for cleanup on shutdown signals
      process.on('SIGINT', async () => {
        logger.info("Received SIGINT signal, initiating shutdown...", serverContext);
        await cleanup();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        logger.info("Received SIGTERM signal, initiating shutdown...", serverContext);
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
      
      // Wrapper for registration with state update
      const registerComponent = async (
        type: 'tool' | 'resource',
        name: string,
        registerFn: () => Promise<void>
      ): Promise<RegistrationResult> => {
        const registrationOpContext = { ...serverContext, operation: `Register${type}`, componentName: name };
        try {
          await ErrorHandler.tryCatch(
            async () => await registerFn(),
            {
              operation: registrationOpContext.operation, // Use specific operation name
              context: registrationOpContext, // Pass context
              errorCode: BaseErrorCode.INTERNAL_ERROR
            }
          );
          
          // Update state based on component type
          if (type === 'tool') {
            serverState.registeredTools.add(name);
          } else {
            serverState.registeredResources.add(name);
          }
          logger.info(`Successfully registered ${type}: ${name}`, registrationOpContext);
          return { success: true, type, name };
        } catch (error) {
           // Safely access error message
           const errorMessage = error instanceof Error ? error.message : String(error);
           logger.error(`Failed initial registration for ${type}: ${name}`, { ...registrationOpContext, error: errorMessage });
          return { success: false, type, name, error };
        }
      };
      
      // Define registration tasks
      const registrationTasks: Promise<RegistrationResult>[] = [
        registerComponent('tool', 'echo_message', () => registerEchoTool(server!)),
        registerComponent('resource', 'echo-resource', () => registerEchoResource(server!))
      ];
      
      // Execute registrations
      const registrationResults = await Promise.allSettled(registrationTasks);
      
      // Process results and identify initial failures
      registrationResults.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.success) {
          // Add successful promise but failed registration to state
           serverState.failedRegistrations.push({
            type: result.value.type,
            name: result.value.name,
            error: result.value.error || new Error('Unknown error during registration'),
            attempts: 1
          });
        } else if (result.status === 'rejected') {
           // This case might happen if ErrorHandler itself fails catastrophically
           logger.error("Catastrophic registration failure", { ...serverContext, reason: result.reason });
           serverState.failedRegistrations.push({
             type: 'unknown' as 'tool', // Placeholder type/name
             name: 'unknown',
             error: result.reason,
             attempts: 1
           });
        }
      });
      
      // Initial status update after first registration attempt
      updateServerStatus(); 
      
      // Set up retry mechanism only if there were initial failures
      if (serverState.failedRegistrations.length > 0) {
        logger.warn(`${serverState.failedRegistrations.length} registrations failed initially, setting up retry...`, {
          ...serverContext,
          failedComponents: serverState.failedRegistrations.map(f => `${f.type}:${f.name}`) 
        });
        
        const retryInterval = setInterval(async () => {
          const retryContext = { ...serverContext, operation: 'RetryRegistrations' };
          await ErrorHandler.tryCatch(
            async () => {
              const retryable = serverState.failedRegistrations.filter(f => f.attempts < MAX_REGISTRATION_RETRIES);
              
              if (retryable.length === 0) {
                logger.info("No more registrations to retry or max attempts reached.", retryContext);
                clearInterval(retryInterval);
                // Final status update after retries stop
                updateServerStatus(); 
                return;
              }
              
              logger.info(`Attempting to retry ${retryable.length} failed registrations...`, retryContext);
              
              // Retry each component
              const retryPromises = retryable.map(async (failedReg) => {
                 const retryAttemptContext = { ...retryContext, componentType: failedReg.type, componentName: failedReg.name, attempt: failedReg.attempts + 1 };
                 try {
                   let registerFn: () => Promise<void>;
                   if (failedReg.type === 'tool' && failedReg.name === 'echo_message') {
                     registerFn = () => registerEchoTool(server!);
                   } else if (failedReg.type === 'resource' && failedReg.name === 'echo-resource') {
                     registerFn = () => registerEchoResource(server!);
                   } else {
                     throw new Error(`Unknown component type/name for retry: ${failedReg.type}/${failedReg.name}`);
                   }

                   await registerComponent(failedReg.type, failedReg.name, registerFn);
                   
                   // If successful, remove from failed list
                   serverState.failedRegistrations = serverState.failedRegistrations.filter(
                     f => !(f.type === failedReg.type && f.name === failedReg.name)
                   );
                   logger.info(`Successfully retried registration`, retryAttemptContext);

                 } catch (error) {
                   // Increment retry count on failure
                   const failedItem = serverState.failedRegistrations.find(
                     f => f.type === failedReg.type && f.name === failedReg.name
                   );
                   if (failedItem) {
                     failedItem.attempts++;
                     failedItem.error = error; // Update error
                     // Safely access error message
                     const errorMessage = error instanceof Error ? error.message : String(error);
                     logger.error(`Retry attempt failed`, { ...retryAttemptContext, error: errorMessage });
                   }
                 }
              });

              await Promise.allSettled(retryPromises);
              
              // After retry attempts for this interval, update server status
              updateServerStatus();
            },
            {
              operation: 'RetryRegistrations', // Keep operation name consistent
              context: retryContext // Pass context
            }
          );
        }, 30000); // Retry every 30 seconds
        
        retryInterval.unref(); // Ensure interval doesn't prevent process exit
        timers.push(retryInterval); // Track for cleanup
      }

      // Connect using stdio transport
      await server.connect(new StdioServerTransport());
      
      // Update server state if not already running (might be degraded)
      if (serverState.status === 'initializing') {
         updateServerStatus(); // Set initial running/degraded state
      }
      
      logger.info("Server started and connected successfully", {
        ...serverContext,
        status: serverState.status, // Log final status after initial registration
        tools: Array.from(serverState.registeredTools),
        resources: Array.from(serverState.registeredResources),
        failedCount: serverState.failedRegistrations.length
      });

      // Add event listener for graceful shutdown state
      serverEvents.on('state:shutting_down', () => cleanup());

      // Run initial health check
      await runHealthCheck();

      return server;
    },
    {
      operation: 'CreateMcpServer', // Keep operation name consistent
      context: serverBaseContext, // Use base context before package info is loaded
      critical: true,
      errorMapper: (error) => new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to initialize MCP server: ${error instanceof Error ? error.message : String(error)}`,
        { 
          serverState: serverState.status,
          startTime: serverState.startTime,
          // Add minimal context available during early failure
        }
      )
    }
  ).catch((error) => { // Catch errors from the main tryCatch block
    // Clean up timers if any were started
    for (const timer of timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    
    // Attempt to close server if it was created
    if (server) {
      try {
        server.close();
      } catch (closeError) {
        logger.debug("Error closing server during error recovery", {
          ...serverBaseContext, // Use base context
          error: closeError instanceof Error ? closeError.message : String(closeError)
        });
      }
    }
    
    // Ensure error is logged if not already by ErrorHandler
    // Safely access error message
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Server initialization failed critically.", { ...serverBaseContext, error: errorMessage });

    // Re-throw to communicate error to caller (e.g., src/index.ts)
    throw error;
  });
};
