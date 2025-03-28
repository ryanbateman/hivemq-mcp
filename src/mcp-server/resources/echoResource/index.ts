import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"; // Corrected imports
import { z } from 'zod';
import { BaseErrorCode, McpError } from '../../../types-global/errors.js'; // Add .js
import { ErrorHandler } from '../../../utils/errorHandler.js'; // Add .js
import { logger } from '../../../utils/logger.js'; // Add .js

// Define context for this resource module
const resourceModuleContext = {
  module: 'EchoResourceRegistration'
};

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

// Define the Zod schema for query parameters separately
const querySchema = z.object({
  message: z.string().optional()
    .describe('Message to echo back in the response')
});

// Infer the type from the Zod schema
type EchoParams = z.infer<typeof querySchema>;

/**
 * Register the echo resource directly with the MCP server instance.
 * 
 * @param server - The MCP server instance to register the resource with (Type corrected to McpServer)
 * @returns Promise resolving when registration is complete
 */
export const registerEchoResource = async (server: McpServer): Promise<void> => { // Type corrected here
  const resourceName = "echo-resource";
  const registrationContext = { ...resourceModuleContext, resourceName };

  logger.info(`Registering resource: ${resourceName}`, registrationContext);

  // Use ErrorHandler for the registration process itself
  await ErrorHandler.tryCatch(
    async () => {
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

      // Register the resource directly using server.resource()
      server.resource(
        resourceName,
        template,
        // Resource metadata
        {
          name: "Echo Message",
          description: "A simple echo resource that returns a message",
          mimeType: "application/json",
          
          // Query schema
          querySchema: querySchema, // Use defined schema
          
          // Examples
          examples: [
            {
              name: "Basic echo",
              uri: "echo://hello",
              description: "Get a default welcome message"
            }
          ],
        },
        
        // Resource handler - uses global logger if needed
        async (uri: URL, params: EchoParams) => { // Added types for uri and params
          const handlerContext = { ...registrationContext, operation: 'handleRequest', uri: uri.href, params };
          logger.debug("Handling echo resource request", handlerContext);
          
          // Use ErrorHandler.tryCatch for the handler logic
          return await ErrorHandler.tryCatch(
            async () => {
              // processEchoResource expects { message?: string }, params matches EchoParams
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
              operation: 'processing echo resource handler',
              context: handlerContext, // Pass handler context to error handler
              input: { uri: uri.href, params },
              // Provide custom error mapping for better error messages
              errorMapper: (error) => new McpError(
                BaseErrorCode.INTERNAL_ERROR, // Keep using BaseErrorCode here as it's internal mapping
                `Error processing echo resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
                { uri: uri.href } // Context for McpError
              )
            }
          );
        }
      );
      
      logger.info(`Resource registered successfully: ${resourceName}`, registrationContext);
    },
    {
      operation: `registering resource ${resourceName}`,
      context: registrationContext, // Context for registration error
      errorCode: BaseErrorCode.INTERNAL_ERROR, // Keep using BaseErrorCode here
      errorMapper: (error) => new McpError(
        error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR, // Keep using BaseErrorCode here
        `Failed to register resource '${resourceName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        { resourceName } // Context for McpError
      ),
      critical: true // Registration failure is critical
    }
  );
};
