import { BaseErrorCode, McpError } from '../../../types-global/errors.js'; // Add .js
import { ErrorContext, ErrorHandler } from '../../../utils/errorHandler.js'; // Add .js
import { logger } from '../../../utils/logger.js'; // Add .js
import { OperationContext, sanitizeInput, sanitizeInputForLogging } from '../../../utils/security.js'; // Add .js
import { EchoToolInput, EchoToolInputSchema, EchoToolResponse } from './types.js'; // Add .js

// Define context for this tool module
const toolModuleContext = {
  module: 'EchoTool'
};

export const echoMessage = async (
  input: unknown,
  context: OperationContext
) => {
  // Extract request ID from context or generate a new one
  const requestId = context.requestContext?.requestId || `echo_${Date.now()}`;
  
  // Combine module and request context for logging
  const logContext = { ...toolModuleContext, requestId };

  // Create error context for consistent error handling
  const errorContext: ErrorContext = {
    requestId,
    toolName: 'echo_message',
    userId: 'anonymous', // Assuming anonymous access
    requestTime: context.requestContext?.timestamp || new Date().toISOString()
  };

  // Sanitize the input for logging to protect sensitive information
  const sanitizedInput = sanitizeInputForLogging(input);

  // Log the incoming request with safe context information
  logger.info("Echo tool request received", { 
    ...logContext,
    rawInputType: typeof input,
    isObject: input !== null && typeof input === 'object',
    sanitizedInput
  });

  return ErrorHandler.tryCatch(async () => {
    // Validate and parse input using zod schema
    let validatedInput: EchoToolInput;
    try {
      validatedInput = EchoToolInputSchema.parse(input);
      
      // Enhanced sanitization on string inputs with context
      validatedInput.message = sanitizeInput.string(validatedInput.message, {
        context: 'text' // Treat as plain text
      });
    } catch (validationError) {
      logger.warn("Echo tool validation error", { 
        ...logContext,
        error: validationError instanceof Error ? validationError.message : 'Unknown validation error',
        rawInput: typeof input === 'object' ? sanitizeInputForLogging(input) : String(input).substring(0, 100)
      });
      
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid echo tool input: ${validationError instanceof Error ? validationError.message : 'Unknown validation error'}`,
        { requestId } // Context for McpError
      );
    }
    
    logger.debug("Echo tool input validated", { 
      ...logContext,
      message: validatedInput.message.substring(0, 50) + (validatedInput.message.length > 50 ? '...' : ''),
      mode: validatedInput.mode,
      repeat: validatedInput.repeat,
      timestamp: validatedInput.timestamp
    });

    try {
      // Process the message according to the requested mode
      let formattedMessage = validatedInput.message;
      switch (validatedInput.mode) {
        case 'uppercase':
          formattedMessage = validatedInput.message.toUpperCase();
          break;
        case 'lowercase':
          formattedMessage = validatedInput.message.toLowerCase();
          break;
        // 'standard' mode keeps the message as-is
      }

      // Repeat the message the specified number of times - limit for safety
      const safeRepeatCount = Math.min(validatedInput.repeat, 10); // Limit repeat count
      const repeatedMessage = Array(safeRepeatCount)
        .fill(formattedMessage)
        .join(' ');

      // Prepare the response
      const response: EchoToolResponse = {
        originalMessage: validatedInput.message,
        formattedMessage,
        repeatedMessage,
        mode: validatedInput.mode,
        repeatCount: safeRepeatCount
      };

      // Add timestamp if requested
      if (validatedInput.timestamp) {
        response.timestamp = new Date().toISOString();
      }

      logger.info("Echo tool response prepared", { 
        ...logContext,
        responseSize: JSON.stringify(response).length,
        mode: response.mode,
        repeatCount: response.repeatCount
      });
      
      // Return in the exact format expected by the MCP SDK
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(response, null, 2) // Add formatting for better readability
        }]
      };
    } catch (processingError) {
      logger.error("Error processing echo tool request", {
        ...logContext,
        error: processingError instanceof Error ? processingError.message : 'Unknown error',
        stack: processingError instanceof Error ? processingError.stack : undefined
      });
      
      // Use more specific error code based on error type
      if (processingError instanceof TypeError || processingError instanceof RangeError) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Error processing input: ${processingError.message}`,
          { requestId } // Context for McpError
        );
      }
      
      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Error processing echo request: ${processingError instanceof Error ? processingError.message : 'Unknown error'}`,
        { requestId } // Context for McpError
      );
    }
  }, {
    context: errorContext, // Context for ErrorHandler
    operation: 'processing echo tool request',
    input: sanitizedInput,
    rethrow: true
  });
};
