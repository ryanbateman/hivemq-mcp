import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // Corrected import
import { z } from 'zod';
import { BaseErrorCode, McpError } from "../../../types-global/errors.js"; // Add .js
import { ErrorHandler } from "../../../utils/errorHandler.js"; // Add .js
import { logger } from "../../../utils/logger.js"; // Add .js
import { ECHO_MODES, EchoToolInput } from './types.js'; // Add .js

// Define context for this tool module
const toolModuleContext = {
  module: 'EchoToolRegistration'
};

/**
 * Process the echo message according to the specified mode and parameters
 * 
 * @param params - Parameters for the echo operation (typed)
 * @returns Processed echo response
 */
const processEchoMessage = (params: EchoToolInput) => { // Use validated EchoToolInput type
  // Process the message according to the requested mode
  let formattedMessage = params.message;
  switch (params.mode) {
    case 'uppercase':
      formattedMessage = params.message.toUpperCase();
      break;
    case 'lowercase':
      formattedMessage = params.message.toLowerCase();
      break;
    // 'standard' mode keeps the message as-is
  }

  // Repeat the message the specified number of times
  const safeRepeatCount = Math.min(params.repeat ?? 1, 10); // Use nullish coalescing for default
  const repeatedMessage = Array(safeRepeatCount)
    .fill(formattedMessage)
    .join(' ');

  // Define the response type with an optional timestamp field
  interface EchoResponse {
    originalMessage: string;
    formattedMessage: string;
    repeatedMessage: string;
    mode: typeof ECHO_MODES[number];
    repeatCount: number;
    timestamp?: string;
  }

  // Prepare the response data
  const response: EchoResponse = {
    originalMessage: params.message,
    formattedMessage,
    repeatedMessage,
    mode: params.mode ?? 'standard', // Use nullish coalescing for default
    repeatCount: safeRepeatCount
  };

  // Add timestamp if requested (default is true)
  if (params.timestamp !== false) {
    response.timestamp = new Date().toISOString();
  }

  return response;
};

// Define the Zod schema for input parameters separately
const inputSchema = z.object({
  message: z.string().min(1).max(1000).describe(
    'The message to echo back (1-1000 characters)'
  ),
  mode: z.enum(ECHO_MODES).optional().default('standard').describe(
    'How to format the echoed message: standard (as-is), uppercase, or lowercase'
  ),
  repeat: z.number().int().min(1).max(10).optional().default(1).describe(
    'Number of times to repeat the message (1-10)'
  ),
  timestamp: z.boolean().optional().default(true).describe(
    'Whether to include a timestamp in the response'
  )
});

// Infer the type from the Zod schema
type EchoInputParams = z.infer<typeof inputSchema>;


/**
 * Register the echo tool directly with the MCP server instance.
 * 
 * @param server - The MCP server instance to register the tool with (Type corrected to McpServer)
 * @returns Promise resolving when registration is complete
 */
export const registerEchoTool = async (server: McpServer): Promise<void> => { // Type corrected here
  const toolName = "echo_message";
  const registrationContext = { ...toolModuleContext, toolName };

  logger.info(`Registering tool: ${toolName}`, registrationContext);

  // Use ErrorHandler for the registration process itself
  await ErrorHandler.tryCatch(
    async () => {
      // Register the tool directly using server.tool()
      server.tool(
        toolName, 
        inputSchema.shape, // Pass the raw shape, not the Zod object
        // Handler function - uses global logger if needed
        async (params: EchoInputParams) => { // Added type for params
          const handlerContext = { ...registrationContext, operation: 'handleRequest', params };
          logger.debug("Handling echo tool request", handlerContext);

          // Use ErrorHandler.tryCatch for the handler logic
          return await ErrorHandler.tryCatch(
            async () => {
              // processEchoMessage expects EchoToolInput, params matches EchoInputParams
              const response = processEchoMessage(params); 

              // Return in the standard MCP format
              return {
                content: [{ 
                  type: "text", 
                  text: JSON.stringify(response, null, 2)
                }]
              };
            },
            {
              operation: 'processing echo message handler',
              context: handlerContext, // Pass handler context to error handler
              input: params,
              // Provide custom error mapping for better error messages
              errorMapper: (error) => new McpError(
                // Use VALIDATION_ERROR for processing errors if they stem from bad input logic
                error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR, // Keep using BaseErrorCode here
                `Error processing echo message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                { toolName } // Context for McpError
              )
            }
          );
        }
      );
      
      logger.info(`Tool registered successfully: ${toolName}`, registrationContext);
    },
    {
      operation: `registering tool ${toolName}`,
      context: registrationContext, // Context for registration error
      errorCode: BaseErrorCode.INTERNAL_ERROR, // Keep using BaseErrorCode here
      errorMapper: (error) => new McpError(
        error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR, // Keep using BaseErrorCode here
        `Failed to register tool '${toolName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        { toolName } // Context for McpError
      ),
      critical: true // Registration failure is critical
    }
  );
};
