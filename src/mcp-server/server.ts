import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// NOTE: HTTP Transport is NOT implemented due to lack of concrete SDK examples/helpers.
// import { StreamableHttpServerTransport } from '@modelcontextprotocol/sdk/server/streamable-http.js'; // Module does not exist
import express from 'express'; // Keep express import for potential future use if needed elsewhere
import { config, environment } from '../config/index.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { requestContextService } from "../utils/requestContext.js";
import { registerEchoResource } from './resources/echoResource/index.js';
import { registerEchoTool } from './tools/echoTool/index.js';

// --- Configuration ---
const TRANSPORT_TYPE = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase(); // Default to stdio
const HTTP_PORT = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : 3000;
const HTTP_HOST = process.env.MCP_HTTP_HOST || '127.0.0.1'; // Default to localhost for security

/**
 * Creates and configures the core McpServer instance and registers capabilities.
 * Does not connect the transport.
 *
 * @async
 * @function createMcpServerInstance
 * @returns {Promise<McpServer>} A promise that resolves with the configured McpServer instance.
 * @throws {Error} Throws an error if critical failures occur during registration.
 */
const createMcpServerInstance = async (): Promise<McpServer> => {
  const operationContext = { operation: 'CreateServerInstance' };
  logger.info("Creating MCP server instance...", operationContext);

  // Configure request context
  requestContextService.configure({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment: environment
  });
  logger.debug("Request context service configured.", operationContext);

  // Create the server instance
  const server = new McpServer(
    {
      name: config.mcpServerName,
      version: config.mcpServerVersion,
    },
    {
      capabilities: {
        resources: {}, // Capabilities added dynamically
        tools: {},
      },
    }
  );
  logger.debug("McpServer instance created.", { ...operationContext, serverName: config.mcpServerName });

  // Register resources and tools
  try {
    logger.info("Registering resources and tools...", operationContext);
    await registerEchoResource(server);
    logger.debug("Echo resource registered.", operationContext);
    await registerEchoTool(server);
    logger.debug("Echo tool registered.", operationContext);
    logger.info("Resources and tools registered successfully.", operationContext);
  } catch (registrationError) {
     logger.error("Critical error during resource/tool registration process", {
        ...operationContext,
        error: registrationError instanceof Error ? registrationError.message : String(registrationError),
        stack: registrationError instanceof Error ? registrationError.stack : undefined,
     });
     throw registrationError; // Halt server startup
  }

  logger.info("MCP server instance configured.", operationContext);
  return server;
};

/**
 * Starts the appropriate transport (stdio or HTTP) based on MCP_TRANSPORT_TYPE env var.
 *
 * @async
 * @function startServerTransport
 * @param {McpServer} server - The configured McpServer instance.
 * @returns {Promise<void>} A promise that resolves when the transport is connected/listening, or rejects on failure.
 * @throws {Error} Throws an error if critical failures occur during transport setup.
 */
const startServerTransport = async (server: McpServer): Promise<void> => {
  const operationContext = { operation: 'StartTransport', transport: TRANSPORT_TYPE };
  logger.info(`Starting MCP server transport: ${TRANSPORT_TYPE}`, operationContext);

  if (TRANSPORT_TYPE === 'http') {
    // --- HTTP Transport Not Supported ---
    const errorMessage = "MCP_TRANSPORT_TYPE=http is not supported in this server version. " +
                         "The provided SDK documentation lacks concrete implementation details for a production-ready HTTP transport handler. " +
                          "Please run using stdio transport (default or MCP_TRANSPORT_TYPE=stdio).";
    // Log as error and exit cleanly via ErrorHandler.
    logger.error(errorMessage, operationContext); // Changed from fatal to error
    ErrorHandler.handleError(new Error(errorMessage), {
        operation: 'UnsupportedTransport', context: operationContext, critical: true // Removed exitprocess property
    });
    // Fallback exit in case ErrorHandler is configured not to exit on critical errors
    process.exit(1);

  } else if (TRANSPORT_TYPE === 'stdio') {
    // --- Start Stdio Transport (Supported) ---
    try {
      logger.info("Connecting server via Stdio transport...", operationContext);
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info(`${config.mcpServerName} connected successfully via stdio`, {
        ...operationContext, serverName: config.mcpServerName, version: config.mcpServerVersion
      });
    } catch (stdioError) {
      ErrorHandler.handleError(stdioError, {
        operation: 'StdioConnection', context: operationContext, critical: true, rethrow: true
      });
      throw stdioError; // Rethrow needed if ErrorHandler doesn't exit
    }

  } else {
    const error = new Error(`Unsupported MCP_TRANSPORT_TYPE: '${TRANSPORT_TYPE}'. Use 'stdio' or 'http'.`);
    logger.error(error.message, operationContext);
    throw error;
  }
};

/**
 * Creates the MCP Server instance and starts the configured transport.
 * This is the main entry point for setting up and running the server logic.
 *
 * @async
 * @function initializeAndStartServer
 * @returns {Promise<McpServer>} A promise that resolves with the running McpServer instance, or rejects on critical failure.
 */
export const initializeAndStartServer = async (): Promise<McpServer> => {
  const serverInstance = await createMcpServerInstance();
  await startServerTransport(serverInstance);
  // If startServerTransport failed critically, it would have thrown an error.
  // If it succeeded, return the instance.
  // For stdio, the process waits for stdin to close.
  // For http, the listener keeps the process alive.
  return serverInstance;
};
