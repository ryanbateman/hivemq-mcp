/**
 * @fileoverview Main entry point for the MCP (Model Context Protocol) server.
 * This file sets up the server instance, registers resources and tools,
 * and orchestrates the connection to the appropriate transport layer (stdio or HTTP).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config, environment } from '../config/index.js';
// Import utils from the main barrel file (ErrorHandler, logger, requestContextService from ../utils/internal/*)
import { ErrorHandler, logger, requestContextService } from '../utils/index.js';
import { registerEchoResource } from './resources/echoResource/index.js';
import { registerEchoTool } from './tools/echoTool/index.js';
import { startHttpTransport } from './transports/httpTransport.js';
import { connectStdioTransport } from './transports/stdioTransport.js';

// --- Configuration Constants ---

/**
 * Determines the transport type for the MCP server based on the MCP_TRANSPORT_TYPE environment variable.
 * Defaults to 'stdio' if the variable is not set. Converts the value to lowercase.
 * @constant {string} TRANSPORT_TYPE - The transport type ('stdio' or 'http').
 */
const TRANSPORT_TYPE = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase();


/**
 * Creates and configures a new instance of the McpServer.
 * This function encapsulates the server setup, including setting the server name,
 * version, capabilities, and registering all defined resources and tools.
 * It's designed to be called either once for the stdio transport or potentially
 * multiple times for stateless handling in the HTTP transport (though currently
 * used once per session in HTTP).
 *
 * @async
 * @returns {Promise<McpServer>} A promise that resolves with the fully configured McpServer instance.
 * @throws {Error} Throws an error if the registration of any resource or tool fails.
 */
async function createMcpServerInstance(): Promise<McpServer> {
  const context = { operation: 'createMcpServerInstance' };
  logger.info('Initializing MCP server instance', context);

  // Configure the request context service for associating logs/traces with specific requests or operations.
  requestContextService.configure({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment,
  });

  // Instantiate the core McpServer with its identity and declared capabilities.
  // Capabilities inform the client about what features the server supports (e.g., logging).
  const server = new McpServer(
    { name: config.mcpServerName, version: config.mcpServerVersion },
    { capabilities: { logging: {}, resources: { listChanged: true }, tools: { listChanged: true } } }
  );

  try {
    // Register all available resources and tools with the server instance.
    // These functions typically call `server.registerResource()` or `server.registerTool()`.
    await registerEchoResource(server);
    await registerEchoTool(server);
    logger.info('Resources and tools registered successfully', context);
  } catch (err) {
    // Log and re-throw any errors during registration, as the server cannot function correctly without them.
    logger.error('Failed to register resources/tools', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err; // Propagate the error to the caller.
  }

  return server;
}


/**
 * Sets up and starts the MCP transport layer based on the `TRANSPORT_TYPE` constant.
 * Delegates the actual transport setup and connection logic to specific functions
 * imported from the `transports/` directory.
 *
 * @async
 * @returns {Promise<McpServer | void>} For 'stdio' transport, returns the `McpServer` instance. For 'http' transport, returns `void` as the server runs indefinitely.
 * @throws {Error} Throws an error if the transport type is unsupported, or if server creation/connection fails.
 */
async function startTransport(): Promise<McpServer | void> {
  const context = { operation: 'startTransport', transport: TRANSPORT_TYPE };
  logger.info(`Starting transport: ${TRANSPORT_TYPE}`, context);

  // --- HTTP Transport Setup ---
  if (TRANSPORT_TYPE === 'http') {
    // Delegate to the HTTP transport setup function.
    // Pass the server instance factory function.
    await startHttpTransport(createMcpServerInstance, context);
    // HTTP server runs indefinitely, so return void.
    return;
  }

  // --- Stdio Transport Setup ---
  if (TRANSPORT_TYPE === 'stdio') {
    // Create a single server instance for the stdio process.
    const server = await createMcpServerInstance();
    // Delegate connection to the Stdio transport function.
    await connectStdioTransport(server, context);
    // Return the server instance, as it might be needed by the calling process.
    return server;
  }

  // --- Unsupported Transport ---
  // If TRANSPORT_TYPE is neither 'http' nor 'stdio'.
  logger.fatal(`Unsupported transport type configured: ${TRANSPORT_TYPE}`, context);
  throw new Error(`Unsupported transport type: ${TRANSPORT_TYPE}. Must be 'stdio' or 'http'.`);
}

/**
 * Main application entry point.
 * Calls `startTransport` to initialize and start the MCP server based on the
 * configured transport type. Handles top-level errors during startup.
 *
 * @async
 * @export
 * @returns {Promise<void | McpServer>} Resolves with the McpServer instance if using stdio, or void if using http (as it runs indefinitely). Rejects on critical startup failure.
 */
export async function initializeAndStartServer(): Promise<void | McpServer> {
  try {
    // Start the appropriate transport (stdio or http).
    return await startTransport();
  } catch (err) {
    // Log fatal errors during the server startup process.
    logger.fatal('Failed to initialize and start MCP server', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    // Use the global error handler for critical failures.
    ErrorHandler.handleError(err, { operation: 'initializeAndStartServer', critical: true });
    // Exit the process with an error code to signal failure.
    process.exit(1);
  }
}
