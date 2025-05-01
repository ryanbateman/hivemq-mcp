import { z } from 'zod';
// Import utils from the main barrel file (OperationContext from ../utils/internal/requestContext.js)
import { OperationContext } from "../utils/index.js";
import { McpToolResult } from './mcp.js'; // Renamed McpToolResponse to McpToolResult

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
 * Interface for a tool handler function
 */
export type ToolHandler<TInput extends BaseToolInput, TResponse extends McpToolResult> = ( // Updated TResponse constraint
  input: TInput,
  context: OperationContext
) => Promise<TResponse>;
