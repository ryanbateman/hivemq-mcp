import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import { ErrorHandler } from "../../../utils/errorHandler.js";
import { ChildLogger } from "../../../utils/logger.js";
import { registerTool } from "../../utils/registrationHelper.js";
import { ECHO_MODES } from './types.js';

/**
 * Process the echo message according to the specified mode and parameters
 * 
 * @param params - Parameters for the echo operation
 * @returns Processed echo response
 */
const processEchoMessage = (params: {
  message: string;
  mode: typeof ECHO_MODES[number];
  repeat: number;
  timestamp: boolean;
}) => {
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
  const safeRepeatCount = Math.min(params.repeat || 1, 10);
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
    mode: params.mode || 'standard',
    repeatCount: safeRepeatCount
  };

  // Add timestamp if requested
  if (params.timestamp !== false) {
    response.timestamp = new Date().toISOString();
  }

  return response;
};

/**
 * Register the echo tool with the MCP server
 * 
 * This function registers a simple echo tool that formats and repeats a message
 * according to specified parameters. It serves as a demonstration of MCP tool
 * implementation with proper input validation, error handling, and response formatting.
 * 
 * @param server - The MCP server instance to register the tool with
 * @returns Promise resolving when registration is complete
 */
export const registerEchoTool = async (server: McpServer): Promise<void> => {
  return registerTool(
    server,
    { name: "echo_message" },
    async (server, toolLogger: ChildLogger) => {
      // Register the tool directly using the simplified SDK pattern
      server.tool(
        // Tool name
        "echo_message", 
        
        // Input schema
        {
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
        },
        
        // Handler function
        async (params) => {
          // Use ErrorHandler.tryCatch for consistent error handling within the handler
          return await ErrorHandler.tryCatch(
            async () => {
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
              operation: 'processing echo message',
              input: params,
              // Provide custom error mapping for better error messages
              errorMapper: (error) => new McpError(
                BaseErrorCode.VALIDATION_ERROR,
                `Error processing echo message: ${error instanceof Error ? error.message : 'Unknown error'}`
              )
            }
          );
        }
      );
      
      toolLogger.info("Echo tool handler registered");
    }
  );
};