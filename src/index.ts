#!/usr/bin/env node
import { ChildProcess, spawn } from "child_process";
import { envConfig } from "./config/envConfig.js";
import { enabledMcpServers, McpServerConfig } from "./config/mcpConfig.js";
import { createMcpServer } from "./mcp-server/server.js";
import { BaseErrorCode, McpError } from "./types-global/errors.js";
import { ErrorHandler } from "./utils/errorHandler.js";
import { idGenerator } from "./utils/idGenerator.js";
import { logger } from "./utils/logger.js";
import { createRequestContext, sanitizeInput } from "./utils/security.js";

// Track active processes
let server: Awaited<ReturnType<typeof createMcpServer>> | undefined;
const mcpServerProcesses: Map<string, ChildProcess> = new Map();

/**
 * Interface to track MCP server process information
 */
interface McpServerProcessInfo {
  name: string;
  process: ChildProcess;
  startTime: Date;
  config: McpServerConfig;
  logger: ReturnType<typeof logger.createChildLogger>;
  status: 'starting' | 'running' | 'error' | 'terminated';
}

/**
 * Spawn MCP servers based on configuration
 * 
 * @returns {Function} A function to shut down the spawned servers
 * @throws {McpError} If there's an error spawning the servers
 */
const spawnMcpServers = () => {
  // Get configured MCP servers
  // Call the function to get MCP servers on demand
  const mcpServers = enabledMcpServers();
  const serverCount = Object.keys(mcpServers).length;
  
  // Create child logger for MCP server management
  const serverLogger = logger.createChildLogger({
    module: 'MCPServerManager',
    serverCount,
    appId: idGenerator.generateRandomString(6)
  });
  
  // Skip if no MCP servers are configured
  if (serverCount === 0) {
    serverLogger.info("No MCP servers configured, skipping spawn");
    return () => Promise.resolve();
  }

  serverLogger.info(`Spawning ${serverCount} configured MCP servers`, {
    serverNames: Object.keys(mcpServers)
  });

  // Spawn MCP servers in parallel
  const spawnPromises = Object.entries(mcpServers).map(([name, serverConfig]: [string, McpServerConfig]) => {
    return ErrorHandler.tryCatch(
      async () => {
        // Sanitize server name for logging
        const safeName = sanitizeInput.string(name);
        
        // Generate a unique ID for this server instance
        const processId = idGenerator.generateRandomString(8);
        
        // Create server-specific logger
        const processLogger = logger.createChildLogger({
          module: 'MCPServerProcess',
          serverName: safeName,
          processId
        });
        
        processLogger.info(`Spawning MCP server process`, {
          command: serverConfig.command,
          args: serverConfig.args,
          hasEnvVars: Object.keys(serverConfig.env || {}).length > 0
        });

        // Spawn the child process
        const childProc = spawn(serverConfig.command, serverConfig.args, {
          env: { ...globalThis.process.env, ...serverConfig.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false
        });

        // Create process info object for tracking
        const processInfo: McpServerProcessInfo = {
          name: safeName,
          process: childProc,
          startTime: new Date(),
          config: serverConfig,
          logger: processLogger,
          status: 'starting'
        };

        // Set up output handling
        childProc.stdout?.on('data', (data: Buffer) => {
          const output = data.toString().trim();
          // Only log non-empty output
          if (output) {
            processLogger.debug(`stdout:`, { output: output.substring(0, 500) });
          }
        });

        childProc.stderr?.on('data', (data: Buffer) => {
          const output = data.toString().trim();
          // Only log non-empty output
          if (output) {
            processLogger.warn(`stderr:`, { output: output.substring(0, 500) });
          }
        });

        // Handle process exit
        childProc.on('exit', (code: number | null, signal: string | null) => {
          processInfo.status = 'terminated';
          const runtime = Date.now() - processInfo.startTime.getTime();
          
          processLogger.info(`MCP server process exited`, { 
            exitCode: code, 
            signal,
            processRuntime: `${runtime / 1000} seconds`
          });
          
          mcpServerProcesses.delete(safeName);
        });

        // Handle process error
        childProc.on('error', (error: Error) => {
          processInfo.status = 'error';
          
          processLogger.error(`MCP server process error`, { 
            error: error.message,
            stack: error.stack
          });
        });

        // Store the process
        mcpServerProcesses.set(safeName, childProc);
        processInfo.status = 'running';
        
        processLogger.info(`MCP server process spawned successfully`, {
          pid: childProc.pid
        });
        
        return processInfo;
      },
      {
        operation: `spawning MCP server ${name}`,
        context: { serverName: name },
        input: { 
          command: serverConfig.command,
          args: serverConfig.args 
        },
        errorCode: BaseErrorCode.INTERNAL_ERROR
      }
    );
  });
  
  // Execute all spawn operations in parallel
  Promise.all(spawnPromises)
    .then(results => {
      const successful = results.filter(r => !(r instanceof Error)).length;
      const failed = results.length - successful;
      
      serverLogger.info(`MCP server spawn results: ${successful} successful, ${failed} failed`);
      
      if (failed > 0) {
        serverLogger.warn(`Some MCP servers failed to spawn`, {
          failedServers: results
            .filter(r => r instanceof Error)
            .map(e => e.message)
        });
      }
    })
    .catch(error => {
      serverLogger.error(`Unexpected error during MCP server spawn`, {
        error: error instanceof Error ? error.message : String(error)
      });
    });

  // Return a function to shut down all spawned servers
  return async () => {
    serverLogger.info(`Shutting down ${mcpServerProcesses.size} MCP servers...`);
    
    const shutdownPromises = Array.from(mcpServerProcesses.entries()).map(([name, childProc]) => {
      // Create a promise for each server shutdown
      return ErrorHandler.tryCatch(
        async () => {
          // Create process-specific shutdown logger
          const shutdownLogger = logger.createChildLogger({
            module: 'MCPServerShutdown',
            serverName: name,
            pid: childProc.pid
          });
          
          shutdownLogger.info(`Terminating MCP server process`);
          
          return new Promise<void>((resolve) => {
            // Set a timeout to force kill if graceful shutdown fails
            const forceKillTimeout = setTimeout(() => {
              shutdownLogger.warn(`Forced kill of MCP server after timeout`);
              if (!childProc.killed) {
                childProc.kill('SIGKILL');
              }
              resolve();
            }, 5000);
            
            // Set up exit handler to clear timeout and resolve
            childProc.once('exit', () => {
              clearTimeout(forceKillTimeout);
              shutdownLogger.info(`MCP server process terminated successfully`);
              resolve();
            });
            
            // Send SIGTERM for graceful shutdown
            if (!childProc.killed) {
              childProc.kill('SIGTERM');
            } else {
              clearTimeout(forceKillTimeout);
              shutdownLogger.info(`MCP server process was already terminated`);
              resolve();
            }
          });
        },
        {
          operation: `shutting down MCP server ${name}`,
          context: { serverName: name, pid: childProc.pid }
        }
      );
    });
    
    try {
      await Promise.all(shutdownPromises);
      serverLogger.info("All MCP servers shut down successfully");
    } catch (error) {
      serverLogger.error(`Error during MCP servers shutdown`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
};

/**
 * Gracefully shut down all MCP servers and the main server
 * 
 * @param signal - The signal that triggered the shutdown
 */
const shutdown = async (signal: string) => {
  // Create shutdown-specific logger
  const shutdownLogger = logger.createChildLogger({
    operation: 'Shutdown',
    signal,
    mcpServerCount: mcpServerProcesses.size
  });
  
  shutdownLogger.info(`Starting graceful shutdown...`);

  try {
    // Shut down MCP servers if any were spawned
    if (mcpServerProcesses.size > 0) {
      shutdownLogger.info(`Shutting down ${mcpServerProcesses.size} MCP server processes`);
      const shutdownMcpServers = spawnMcpServers();
      await shutdownMcpServers();
    }

    // Close the main MCP server
    if (server) {
      shutdownLogger.info("Closing main MCP server...");
      await server.close();
      shutdownLogger.info("Main MCP server closed successfully");
    }

    shutdownLogger.info("Graceful shutdown completed successfully");
    process.exit(0);
  } catch (error) {
    // Handle any errors during shutdown
    shutdownLogger.error("Critical error during shutdown", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
};

/**
 * Start the MCP server and spawn configured child MCP servers
 */
const start = async () => {
  // Create application-level request context
  const startupContext = createRequestContext({
    operation: 'ServerStartup',
    appName: 'mcp-ts-template', // Hard-coded for startup, will be loaded from package.json later
    appVersion: '1.0.0',        // Hard-coded for startup, will be loaded from package.json later 
    environment: envConfig().environment
  });
  
  // Create startup logger with context
  const startupLogger = logger.createChildLogger({
    operation: 'Startup',
    requestId: startupContext.requestId,
    appName: 'mcp-ts-template',
    environment: envConfig().environment
  });

  startupLogger.info("Starting MCP Template Server...");

  try {
    // Use Promise.all to parallelize startup operations where possible
    const [mcpShutdownFn] = await Promise.all([
      // Spawn configured MCP servers
      ErrorHandler.tryCatch(
        async () => {
          startupLogger.debug("Spawning configured MCP servers");
          return spawnMcpServers();
        },
        { operation: 'spawning MCP servers' }
      )
    ]);

    // Create and store server instance (must be after MCP servers are spawned)
    startupLogger.debug("Creating main MCP server instance");
    server = await ErrorHandler.tryCatch(
      async () => await createMcpServer(),
      { operation: 'creating main MCP server' }
    );
    
    startupLogger.info("MCP Template Server is running and awaiting messages", {
      startTime: new Date().toISOString(),
      environment: envConfig().environment
    });

    // Handle process signals for graceful shutdown
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception", { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      shutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason: unknown) => {
      logger.error("Unhandled rejection", { 
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
      });
      shutdown("UNHANDLED_REJECTION");
    });
  } catch (error) {
    // Handle startup errors
    startupLogger.error("Critical error during startup", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
};

start();