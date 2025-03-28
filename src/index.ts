#!/usr/bin/env node
import { config, environment } from "./config/index.js";
import { createMcpServer } from "./mcp-server/server.js";
import { BaseErrorCode, McpError } from "./types-global/errors.js";
import { ErrorHandler } from "./utils/errorHandler.js";
import { logger } from "./utils/logger.js";
import { createRequestContext } from "./utils/requestContext.js"; // Updated import

// Track the main server instance
let server: Awaited<ReturnType<typeof createMcpServer>> | undefined;

/**
 * Gracefully shut down the main server
 * 
 * @param signal - The signal that triggered the shutdown
 */
const shutdown = async (signal: string) => {
  // Define context for the shutdown operation
  const shutdownContext = {
    operation: 'Shutdown',
    signal,
  };
  
  logger.info(`Starting graceful shutdown...`, shutdownContext);

  try {
    // Close the main MCP server
    if (server) {
      logger.info("Closing main MCP server...", shutdownContext);
      await server.close();
      logger.info("Main MCP server closed successfully", shutdownContext);
    } else {
      logger.warn("Server instance not found during shutdown.", shutdownContext);
    }

    logger.info("Graceful shutdown completed successfully", shutdownContext);
    process.exit(0);
  } catch (error) {
    // Handle any errors during shutdown
    logger.error("Critical error during shutdown", { 
      ...shutdownContext,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
};

/**
 * Start the main MCP server
 */
const start = async () => {
  // Create application-level request context
  const startupContext = createRequestContext({
    operation: 'ServerStartup',
    appName: config.mcpServerName, 
    appVersion: config.mcpServerVersion,
    environment: environment // Use imported environment
  });
  
  logger.info(`Starting ${config.mcpServerName} v${config.mcpServerVersion}...`, { 
    ...startupContext, 
    operation: 'Startup' // Add operation directly
  });

  try {
    // Create and store the main server instance
    logger.debug("Creating main MCP server instance", { ...startupContext, operation: 'Startup' });
    server = await ErrorHandler.tryCatch(
      async () => await createMcpServer(),
      { 
        operation: 'creating main MCP server', 
        context: { ...startupContext, operation: 'Startup' }, // Use startupContext
        errorCode: BaseErrorCode.INTERNAL_ERROR // Specify error code for failure
      }
    );
    
    // Check if server creation resulted in an error
    if (server instanceof Error) {
      // If ErrorHandler returns an error, it's already logged. Just throw to exit.
      throw server; 
    }

    logger.info(`${config.mcpServerName} is running and awaiting messages`, {
      ...startupContext, // Use startupContext
      operation: 'Startup', // Add operation
      startTime: new Date().toISOString(),
    });

    // Handle process signals for graceful shutdown
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught errors
    process.on("uncaughtException", async (error) => { // Add async
      const errorContext = {
        ...startupContext, // Include base context
        event: 'uncaughtException',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      };
      logger.error("Uncaught exception detected", errorContext);
      // Attempt graceful shutdown on uncaught exception
      try {
        await shutdown("uncaughtException"); // Await shutdown
      } catch (err) {
        logger.error("Failed to shutdown gracefully after uncaught exception", { 
          ...errorContext, 
          shutdownError: err instanceof Error ? err.message : String(err) 
        });
        process.exit(1); // Force exit if shutdown fails
      }
    });

    process.on("unhandledRejection", async (reason: unknown) => { // Add async
      const rejectionContext = {
        ...startupContext, // Include base context
        event: 'unhandledRejection',
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
      };
      logger.error("Unhandled rejection detected", rejectionContext);
       // Attempt graceful shutdown on unhandled rejection
       try {
         await shutdown("unhandledRejection"); // Await shutdown
       } catch (err) {
         logger.error("Failed to shutdown gracefully after unhandled rejection", { 
           ...rejectionContext, 
           shutdownError: err instanceof Error ? err.message : String(err) 
         });
         process.exit(1); // Force exit if shutdown fails
       }
    });
  } catch (error) {
    // Handle critical startup errors (already logged by ErrorHandler or caught above)
    logger.error("Critical error during startup, exiting.", { 
      ...startupContext, // Use startupContext
      // Error should have been logged already, just adding context
      finalErrorContext: 'Startup Failure',
      operation: 'Startup' // Add operation
    });
    process.exit(1);
  }
};

// Start the application
start();
