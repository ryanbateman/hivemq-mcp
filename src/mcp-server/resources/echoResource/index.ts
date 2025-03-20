import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { BaseErrorCode, McpError } from '../../../types-global/errors.js';
import { ErrorHandler } from '../../../utils/errorHandler.js';
import { ChildLogger } from '../../../utils/logger.js';
import { registerResource } from '../../utils/registrationHelper.js';

/**
 * Process the echo resource request
 * 
 * @param uri The resource URI 
 * @param params The query parameters
 * @returns Processed response data
 */
const processEchoResource = (uri: URL, params: { message?: string }) => {
  // Extract message from params or use default
  const message = params.message || 'Hello from echo resource!';
  
  // Prepare response data
  return {
    message,
    timestamp: new Date().toISOString(),
    requestUri: uri.href
  };
};

/**
 * Register the echo resource with the MCP server
 * 
 * This function creates and registers the echo resource which returns a message
 * provided in the query parameters. It configures the resource with appropriate
 * metadata, rate limiting, and caching settings.
 * 
 * @param server - The MCP server instance to register the resource with
 * @returns Promise resolving when registration is complete
 */
export const registerEchoResource = async (server: McpServer): Promise<void> => {
  return registerResource(
    server,
    { name: "echo-resource" },
    async (server, resourceLogger: ChildLogger) => {
      // Create resource template
      const template = new ResourceTemplate(
        "echo://{message}",
        {
          // Simple list implementation
          list: async () => ({
            resources: [{
              uri: "echo://hello",
              name: "Default Echo Message",
              description: "A simple echo resource example"
            }]
          }),
          // No completion needed for this resource
          complete: {}
        }
      );

      // Register the resource
      server.resource(
        // Resource name
        "echo-resource",
        
        // Resource template
        template,
        
        // Resource metadata
        {
          name: "Echo Message",
          description: "A simple echo resource that returns a message",
          mimeType: "application/json",
          
          // Query schema
          querySchema: z.object({
            message: z.string().optional()
              .describe('Message to echo back in the response')
          }),
          
          // Examples
          examples: [
            {
              name: "Basic echo",
              uri: "echo://hello",
              description: "Get a default welcome message"
            }
          ],
        },
        
        // Resource handler
        async (uri, params) => {
          // Use ErrorHandler.tryCatch for consistent error handling
          return await ErrorHandler.tryCatch(
            async () => {
              const responseData = processEchoResource(uri, params);
              
              // Return in the standardized format expected by the MCP SDK
              return {
                contents: [{
                  uri: uri.href,
                  text: JSON.stringify(responseData, null, 2),
                  mimeType: "application/json"
                }]
              };
            },
            {
              operation: 'processing echo resource',
              input: { uri: uri.href, params },
              // Provide custom error mapping for better error messages
              errorMapper: (error) => new McpError(
                BaseErrorCode.INTERNAL_ERROR,
                `Error processing echo resource: ${error instanceof Error ? error.message : 'Unknown error'}`
              )
            }
          );
        }
      );
      
      resourceLogger.info("Echo resource handler registered");
    }
  );
};