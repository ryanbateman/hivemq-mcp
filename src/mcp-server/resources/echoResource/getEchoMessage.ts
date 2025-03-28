import { BaseErrorCode, McpError } from '../../../types-global/errors.js'; // Add .js
import { ErrorHandler } from '../../../utils/errorHandler.js'; // Add .js
import { logger } from '../../../utils/logger.js'; // Add .js
import { createRequestContext } from '../../../utils/requestContext.js'; // Updated import
import { sanitizeInput } from '../../../utils/sanitization.js'; // Updated import
import { EchoResourceQuery, EchoResourceQuerySchema, EchoResourceResponse } from './types.js'; // Add .js

// Define context for this resource module
const resourceModuleContext = {
  module: 'EchoResource'
};

export const getEchoMessage = async (uri: URL): Promise<EchoResourceResponse> => {
  // Create a request context with unique ID
  const requestContext = createRequestContext({ 
    operation: 'getEchoMessage',
    uri: uri.toString() 
  });
  const requestId = requestContext.requestId;

  // Combine module and request context for logging
  const logContext = { ...resourceModuleContext, requestId, uri: uri.href };

  // Parse and validate query parameters
  const queryParams: Record<string, string> = {};
  uri.searchParams.forEach((value, key) => {
    // Sanitize input parameters
    queryParams[key] = sanitizeInput.string(value);
  });

  logger.info("Echo resource request received", { 
    ...logContext,
    queryParams
  });

  return ErrorHandler.tryCatch(async () => {
    let validatedQuery: EchoResourceQuery;
    try {
      validatedQuery = EchoResourceQuerySchema.parse(queryParams);
    } catch (validationError) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid echo resource query parameters',
        { 
          error: validationError instanceof Error ? validationError.message : 'Unknown validation error',
          requestId, // Keep requestId in error context
          params: queryParams
        }
      );
    }

    // Prepare response data
    const message = validatedQuery.message || 'Hello from echo resource!';
    const responseData = {
      message,
      timestamp: new Date().toISOString(),
      requestUri: uri.href,
      requestId
    };

    logger.info("Echo resource response data prepared", { 
      ...logContext,
      responseData
    });
    
    // Return in the standard MCP format 
    const response: EchoResourceResponse = {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(responseData, null, 2),
        mimeType: "application/json"
      }]
    };
    
    return response;
  }, {
    context: { // Context for ErrorHandler
      requestId, 
      uri: uri.toString() 
    },
    operation: 'processing echo resource request',
    errorMapper: (error) => {
      // Map validation errors to VALIDATION_ERROR, other errors to INTERNAL_ERROR
      const errorPattern = [
        { 
          pattern: /invalid|validation|parse/i, 
          errorCode: BaseErrorCode.VALIDATION_ERROR,
          factory: () => 
            new McpError(BaseErrorCode.VALIDATION_ERROR, 
              `Invalid echo resource parameters: ${error instanceof Error ? error.message : 'Unknown error'}`,
              { requestId, uri: uri.toString() }) // Include context in mapped error
        }
      ];
      
      return ErrorHandler.mapError(
        error, 
        errorPattern, 
        () => new McpError(
          BaseErrorCode.INTERNAL_ERROR, 
          `Error processing echo resource request: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { requestId, uri: uri.toString() } // Include context in mapped error
        )
      );
    },
    rethrow: true
  });
};
