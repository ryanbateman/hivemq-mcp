import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Import McpServer
import {
  ErrorCode, // Import SDK ErrorCode
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { config, environment } from '../config/index.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { configureContext } from "../utils/requestContext.js";
import { registerEchoResource } from './resources/echoResource/index.js';
import { registerEchoTool } from './tools/echoTool/index.js';

/**
 * Create and configure the main MCP server instance
 * @returns The configured MCP server instance
 */
export const createMcpServer = async () => {
  // Configure request context settings
  configureContext({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment: environment
  });

  // Create the server instance using McpServer
  const server = new McpServer( // Use McpServer instead of Server
    {
      name: config.mcpServerName,
      version: config.mcpServerVersion,
    },
    {
      capabilities: {
        // Capabilities are defined via registration functions
        resources: {},
        tools: {},
      },
    }
  );

  // Removed server.onerror assignment - global errors handled by process handlers in index.ts

  // Register resources and tools using their dedicated functions
  try {
    // Pass the McpServer instance to the registration functions
    await registerEchoResource(server);
    await registerEchoTool(server);
  } catch (registrationError) {
     // ErrorHandler within registration functions should handle logging/throwing
     logger.error("Critical error during resource/tool registration", {
        error: registrationError instanceof Error ? registrationError.message : String(registrationError),
        stack: registrationError instanceof Error ? registrationError.stack : undefined,
        operation: 'Server Initialization'
     });
     // Rethrow to halt server startup if registration fails critically
     throw registrationError;
  }


  // Connect the server using Stdio transport
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${config.mcpServerName} connected via stdio`, {
      serverName: config.mcpServerName,
      version: config.mcpServerVersion
    });
  } catch (error) {
    // Handle connection errors specifically
    ErrorHandler.handleError(error, {
      operation: 'Server Connection',
      critical: true,
      rethrow: true // Rethrow to allow startup process to handle exit
    });
    // The line below won't be reached if rethrow is true, but needed for type safety
    throw error;
  }

  return server;
};
