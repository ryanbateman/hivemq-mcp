import { z } from 'zod';
import { BaseErrorCode, McpError } from './errors.js'; // Add .js
import { OperationContext } from "../utils/requestContext.js"; // Updated import
import { ErrorHandler } from "../utils/errorHandler.js"; // Add .js
import { logger } from "../utils/logger.js"; // Add .js

/**
 * Base interface for tool input parameters
 */
export interface BaseToolInput {
  [key: string]: unknown;
}

/**
 * Base interface for tool response content
 */
export interface BaseToolResponse {
  [key: string]: unknown;
}

/**
 * Standard MCP tool response format
 */
export interface McpToolResponse {
  content: {
    type: "text" | "json" | "markdown";
    text: string;
  }[];
  isError?: boolean;
}

/**
 * Interface for a tool handler function
 */
export type ToolHandler<TInput extends BaseToolInput, TResponse extends McpToolResponse> = (
  input: TInput,
  context: OperationContext
) => Promise<TResponse>;

/**
 * Interface for tool registration options
 */
export interface ToolRegistrationOptions<TInput extends BaseToolInput> {
  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>;
  /** Description of the tool */
  description: string;
  /** Example usage scenarios */
  examples?: { name: string; input: TInput; description?: string }[];
}

/**
 * Abstract base class for defining and registering MCP tools
 */
export abstract class Tool<TInput extends BaseToolInput, TResponse extends McpToolResponse> {
  protected abstract name: string;
  protected abstract description: string;
  protected abstract inputSchema: z.ZodType<TInput>;
  protected abstract examples?: { name: string; input: TInput; description?: string }[];

  /**
   * Abstract method to handle the tool execution logic
   * @param input Validated tool input
   * @param context Operation context
   * @returns Tool response
   */
  protected abstract handle(input: TInput, context: OperationContext): Promise<TResponse>;

  /**
   * Get the registration options for this tool
   * @returns Tool registration options
   */
  public getRegistrationOptions(): ToolRegistrationOptions<TInput> {
    return {
      inputSchema: this.inputSchema,
      description: this.description,
      examples: this.examples
    };
  }

  /**
   * Get the handler function for this tool, including validation and error handling
   * @returns Tool handler function
   */
  public getHandler(): ToolHandler<TInput, TResponse> {
    return async (rawInput: unknown, context: OperationContext): Promise<TResponse> => {
      const operation = `Executing tool: ${this.name}`;
      const logContext = { toolName: this.name, requestId: context.requestContext?.requestId };
      
      logger.debug(`${operation} - Received input`, { ...logContext, rawInput });

      return ErrorHandler.tryCatch(
        async () => {
          // Validate input
          let validatedInput: TInput;
          try {
            validatedInput = this.inputSchema.parse(rawInput);
            logger.debug(`${operation} - Input validated`, logContext);
          } catch (validationError) {
            logger.warn(`${operation} - Validation failed`, { 
              ...logContext, 
              error: validationError instanceof Error ? validationError.message : 'Unknown validation error' 
            });
            throw new McpError(
              BaseErrorCode.VALIDATION_ERROR,
              `Invalid input for tool '${this.name}': ${validationError instanceof Error ? validationError.message : 'Unknown validation error'}`,
              { toolName: this.name }
            );
          }

          // Execute the tool's handle method
          const result = await this.handle(validatedInput, context);
          logger.debug(`${operation} - Execution successful`, logContext);
          return result;
        },
        {
          operation,
          context: { ...logContext, toolName: this.name },
          input: rawInput, // Log raw input on error
          rethrow: true, // Rethrow errors to be handled by the server
          errorMapper: (error) => {
            // If it's already an McpError, just add context
            if (error instanceof McpError) {
              error.details = { ...error.details, toolName: this.name };
              return error;
            }
            // Otherwise, wrap it
            return new McpError(
              BaseErrorCode.INTERNAL_ERROR,
              `Error executing tool '${this.name}': ${error instanceof Error ? error.message : 'Unknown error'}`,
              { toolName: this.name, originalError: error instanceof Error ? error.name : typeof error }
            );
          }
        }
      );
    };
  }
}
