/**
 * @fileoverview Handles the setup and connection for the Stdio MCP transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// Import utils from the main barrel file (ErrorHandler from ../../utils/internal/errorHandler.js, logger from ../../utils/internal/logger.js)
import { ErrorHandler, logger } from '../../utils/index.js';

/**
 * Connects a given McpServer instance to the Stdio transport.
 * Reads from stdin and writes to stdout.
 *
 * @async
 * @param {McpServer} server - The McpServer instance to connect.
 * @param {Record<string, any>} context - Logging context.
 * @returns {Promise<void>} A promise that resolves when the connection is established.
 * @throws {Error} Throws an error if the connection fails.
 */
export async function connectStdioTransport(server: McpServer, context: Record<string, any>): Promise<void> {
  try {
    // Create the stdio transport, which reads from stdin and writes to stdout.
    const transport = new StdioServerTransport();
    // Connect the server logic to the stdio transport.
    await server.connect(transport);
    logger.info('MCP Server connected via stdio transport', context);
  } catch (err) {
    // Handle critical errors during stdio setup.
    ErrorHandler.handleError(err, { ...context, operation: 'connectStdioTransport', critical: true });
    // Rethrow to indicate failure.
    throw err;
  }
}
