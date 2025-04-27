#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Import McpServer type
import { config, environment } from "./config/index.js";
import { initializeAndStartServer } from "./mcp-server/server.js"; // Updated import
import { logger } from "./utils/logger.js";
// Import the service instance instead of the standalone function
import { requestContextService } from "./utils/requestContext.js";

/**
 * The main MCP server instance.
 * @type {McpServer | undefined}
 */
let server: McpServer | undefined;

/**
 * Gracefully shuts down the main MCP server.
 * Handles process termination signals (SIGTERM, SIGINT) and critical errors.
 *
 * @param signal - The signal or event name that triggered the shutdown (e.g., "SIGTERM", "uncaughtException").
 */
const shutdown = async (signal: string) => {
  // Define context for the shutdown operation
  const shutdownContext = {
    operation: 'Shutdown',
    signal,
  };

  logger.info(`Received ${signal}. Starting graceful shutdown...`, shutdownContext);

  try {
    // Close the main MCP server
    if (server) {
      logger.info("Closing main MCP server...", shutdownContext);
      await server.close();
      logger.info("Main MCP server closed successfully", shutdownContext);
    } else {
      logger.warning("Server instance not found during shutdown.", shutdownContext);
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
    process.exit(1); // Exit with error code if shutdown fails
  }
};

/**
 * Initializes and starts the main MCP server.
 * Sets up request context, initializes the server instance, starts the transport,
 * and registers signal handlers for graceful shutdown and error handling.
 */
const start = async () => {
  // Create application-level request context using the service instance
  const transportType = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase();
  const startupContext = requestContextService.createRequestContext({
    operation: `ServerStartup_${transportType}`, // Include transport in operation name
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment: environment
  });

  logger.info(`Starting ${config.mcpServerName} v${config.mcpServerVersion} (Transport: ${transportType})...`, startupContext);

  try {
    // Initialize the server instance and start the selected transport
    logger.debug("Initializing and starting MCP server transport", startupContext);

    // Start the server transport. For stdio, this returns the server instance.
    // For http, it sets up the listener and returns void (or potentially the http.Server).
    // We only need to store the instance for stdio shutdown.
    const potentialServerInstance = await initializeAndStartServer();
    if (transportType === 'stdio' && potentialServerInstance instanceof McpServer) {
        server = potentialServerInstance; // Store only for stdio
    } else {
        // For HTTP, server instances are managed per-session in server.ts
        // The main http server listener keeps the process alive.
        // Shutdown for HTTP needs to handle closing the main http server.
        // We might need to return the httpServer from initializeAndStartServer if
        // we want to close it explicitly here during shutdown.
        // For now, we don't store anything globally for HTTP transport.
    }


    // If initializeAndStartServer failed, it would have thrown an error,
    // and execution would jump to the outer catch block.

    logger.info(`${config.mcpServerName} is running with ${transportType} transport`, {
      ...startupContext,
      startTime: new Date().toISOString(),
    });

    // --- Signal and Error Handling Setup ---

    // Handle process signals for graceful shutdown
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", async (error) => {
      const errorContext = {
        ...startupContext, // Include base context for correlation
        event: 'uncaughtException',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      };
      logger.error("Uncaught exception detected. Initiating shutdown...", errorContext);
      // Attempt graceful shutdown; shutdown() handles its own errors.
      await shutdown("uncaughtException");
      // If shutdown fails internally, it will call process.exit(1).
      // If shutdown succeeds, it calls process.exit(0).
      // If shutdown itself throws unexpectedly *before* exiting, this process might terminate abruptly,
      // but the core shutdown logic is handled within shutdown().
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", async (reason: unknown) => {
      const rejectionContext = {
        ...startupContext, // Include base context for correlation
        event: 'unhandledRejection',
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
      };
      logger.error("Unhandled promise rejection detected. Initiating shutdown...", rejectionContext);
      // Attempt graceful shutdown; shutdown() handles its own errors.
      await shutdown("unhandledRejection");
      // Similar logic as uncaughtException: shutdown handles its exit codes.
    });
  } catch (error) {
    // Handle critical startup errors (already logged by ErrorHandler or caught above)
    // Log the final failure context, including error details, before exiting
    logger.error("Critical error during startup, exiting.", {
      ...startupContext,
      finalErrorContext: 'Startup Failure',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
};

// Start the application
start();
