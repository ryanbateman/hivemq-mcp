import { BaseErrorCode, McpError } from '../../../types-global/errors.js';
import { ErrorContext, ErrorHandler } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { OperationContext, sanitizeInput, sanitizeInputForLogging } from '../../../utils/security.js';
import { EchoToolInput, EchoToolInputSchema, EchoToolResponse } from './types.js';

// Create tool-specific logger with context
const toolLogger = logger.createChildLogger({
  service: 'EchoTool'
});

export const echoMessage = async (
  input: unknown,
  context: OperationContext
) => {
  // Extract request ID from context or generate a new one
  const requestId = context.requestContext?.requestId || `echo_${Date.now()}`;
  
  // Create error context for consistent error handling
  const errorContext: ErrorContext = {
    requestId,
    toolName: 'echo_message',
    userId: 'anonymous', // Removed user.id reference since auth was removed
    requestTime: context.requestContext?.timestamp || new Date().toISOString()
  };

  // Sanitize the input for logging to protect sensitive information
  const sanitizedInput = sanitizeInputForLogging(input);

  // Log the incoming request with safe context information
  toolLogger.info("Echo tool request received", { 
    requestId,
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
      toolLogger.warn("Echo tool validation error", { 
        requestId,
        error: validationError instanceof Error ? validationError.message : 'Unknown validation error',
        rawInput: typeof input === 'object' ? sanitizeInputForLogging(input) : String(input).substring(0, 100)
      });
      
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid echo tool input: ${validationError instanceof Error ? validationError.message : 'Unknown validation error'}`,
        { requestId }
      );
    }
    
    toolLogger.debug("Echo tool input validated", { 
      requestId,
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
      const safeRepeatCount = Math.min(validatedInput.repeat, 10);
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

      toolLogger.info("Echo tool response prepared", { 
        requestId,
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
      toolLogger.error("Error processing echo tool request", {
        requestId,
        error: processingError instanceof Error ? processingError.message : 'Unknown error',
        stack: processingError instanceof Error ? processingError.stack : undefined
      });
      
      // Use more specific error code based on error type
      if (processingError instanceof TypeError || processingError instanceof RangeError) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Error processing input: ${processingError.message}`,
          { requestId }
        );
      }
      
      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Error processing echo request: ${processingError instanceof Error ? processingError.message : 'Unknown error'}`,
        { requestId }
      );
    }
  }, {
    context: errorContext,
    operation: 'processing echo tool request',
    input: sanitizedInput,
    rethrow: true
  });
};