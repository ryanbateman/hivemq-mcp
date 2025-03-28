import { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { BaseErrorCode, McpError } from '../../../types-global/errors.js';
import { logger } from '../../../utils/logger.js';
import { requestContextService } from '../../../utils/requestContext.js';
// Import the sanitization service instance
import { sanitization } from '../../../utils/sanitization.js'; 
import { EchoToolInputSchema, EchoToolInput } from './types.js';

/**
 * Handler for the echo_message tool.
 * 
 * @param request - The CallToolRequest containing tool arguments.
 * @returns A promise resolving to the tool response content.
 * @throws {McpError} If input validation fails.
 */
export const echoMessage = async (request: CallToolRequest) => {
  const requestContext = requestContextService.createRequestContext({
    operation: 'echoMessageTool',
    toolName: request.params.name,
  });

  logger.info('Handling echoMessage tool request', requestContext);

  try {
    // Validate input against the Zod schema
    const validatedInput: EchoToolInput = EchoToolInputSchema.parse(request.params.arguments);
    
    logger.debug('Input validated successfully', { ...requestContext, input: validatedInput });

    // Sanitize the message string using the sanitization service instance
    // Ensure message is treated as plain text, stripping any potential HTML
    if (validatedInput.message) {
      validatedInput.message = sanitization.sanitizeString(validatedInput.message, {
        context: 'text' // Treat as plain text
      });
      logger.debug('Message sanitized', { ...requestContext, sanitizedMessage: validatedInput.message });
    }

    // Process the message based on the mode
    let processedMessage = validatedInput.message;
    switch (validatedInput.mode) {
      case 'uppercase':
        processedMessage = processedMessage.toUpperCase();
        break;
      case 'lowercase':
        processedMessage = processedMessage.toLowerCase();
        break;
      // 'standard' mode requires no change
    }

    // Repeat the message if necessary
    const repeatedMessage = Array(validatedInput.repeat).fill(processedMessage).join(' ');

    // Construct the response text
    let responseText = repeatedMessage;
    if (validatedInput.timestamp) {
      responseText = `[${new Date().toISOString()}] ${repeatedMessage}`;
    }

    logger.info('Echo tool executed successfully', { ...requestContext, responseLength: responseText.length });

    // Return the result
    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
    };
  } catch (error) {
    // Handle validation errors (e.g., from Zod)
    if (error instanceof Error && error.name === 'ZodError') {
      logger.warn('Input validation failed for echoMessage tool', { 
        ...requestContext, 
        error: error.message, 
        issues: (error as any).issues // Zod adds issues details
      });
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid input: ${error.message}`,
        { issues: (error as any).issues }
      );
    }
    
    // Handle other unexpected errors
    logger.error('Unexpected error in echoMessage tool', { 
      ...requestContext, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      'An unexpected error occurred while processing the echo request.',
      { originalError: error instanceof Error ? error.name : 'Unknown' }
    );
  }
};
