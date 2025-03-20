import { z } from 'zod';
import { RateLimitConfig } from "../utils/rateLimiter.js";
import { OperationContext } from "../utils/security.js";
import { ErrorHandler } from "../utils/errorHandler.js";
import { logger } from "../utils/logger.js";

// Create a module-level logger
const toolLogger = logger.createChildLogger({
  module: 'ToolRegistration'
});

/**
 * Metadata for a tool example
 */
export interface ToolExample {
  /** Example input parameters */
  input: Record<string, unknown>;
  /** Expected output string */
  output: string;
  /** Description of the example */
  description: string;
}

/**
 * Configuration for a tool
 */
export interface ToolMetadata {
  /** Examples showing how to use the tool */
  examples: ToolExample[];
  /** Optional permission required for this tool */
  requiredPermission?: string;
  /** Optional schema for the return value */
  returnSchema?: z.ZodType<unknown>;
  /** Rate limit configuration for the tool */
  rateLimit?: RateLimitConfig;
  /** Whether this tool can be used without authentication */
  allowUnauthenticated?: boolean;
}

/**
 * Create a tool example
 * 
 * @param input Example input parameters
 * @param output Expected output (as a formatted string)
 * @param description Description of what the example demonstrates
 * @returns A tool example object
 */
export function createToolExample(
  input: Record<string, unknown>,
  output: string,
  description: string
): ToolExample {
  return {
    input,
    output,
    description
  };
}

/**
 * Create tool metadata
 * 
 * @param metadata Tool metadata options
 * @returns Tool metadata configuration
 */
export function createToolMetadata(metadata: ToolMetadata): ToolMetadata {
  return metadata;
}

/**
 * Register a tool with the MCP server
 * 
 * This is a compatibility wrapper for the McpServer.tool() method.
 * In the current implementation, the tool registration is handled by the McpServer class,
 * so this function primarily exists to provide a consistent API.
 * 
 * @param server MCP server instance
 * @param name Tool name
 * @param description Tool description
 * @param inputSchema Schema for validating input
 * @param handler Handler function for the tool
 * @param metadata Optional tool metadata
 */
export function registerTool(
  server: any,  // Using any to avoid type conflicts
  name: string, 
  description: string, 
  inputSchema: Record<string, z.ZodType<any>>, 
  handler: (input: unknown, context: OperationContext) => Promise<unknown>,
  metadata?: ToolMetadata  
): Promise<void> {
  return ErrorHandler.tryCatch<void>(
    async () => {
      // Log the registration attempt
      toolLogger.info(`Registering tool: ${name}`, {
        toolName: name,
        schemaKeys: Object.keys(inputSchema),
        hasMetadata: Boolean(metadata),
        hasExamples: Boolean(metadata?.examples?.length)
      });
      
      // Some basic validation
      if (!name) {
        throw new Error('Tool name is required');
      }
      
      if (!inputSchema) {
        throw new Error('Input schema is required');
      }
      
      if (!handler || typeof handler !== 'function') {
        throw new Error('Handler must be a function');
      }

      // Convert schema to a more standardized format if needed
      const schemaDescription = Object.entries(inputSchema).map(([key, schema]) => {
        const description = schema.description;
        const isRequired = !schema.isOptional?.();
        return `${key}${isRequired ? ' (required)' : ''}: ${description || 'No description'}`;
      }).join('\n');

      toolLogger.debug(`Tool ${name} schema:`, {
        toolName: name,
        schema: schemaDescription
      });

      // Actually register the tool with the server
      // Check if it's an McpServer instance with tool() method
      if (server.tool && typeof server.tool === 'function') {
        // Use the McpServer.tool() method directly
        toolLogger.debug('Using McpServer.tool() method');
        server.tool(name, inputSchema, handler, {
          description,
          examples: metadata?.examples
        });
      } else {
        // For other server types or for testing, log a warning
        toolLogger.warn(`Unable to register tool ${name} with server - missing tool() method`, {
          toolName: name
        });
      }

      // Log successful registration
      toolLogger.info(`Tool ${name} registered successfully`);
    },
    {
      context: { toolName: name },
      operation: "registering tool",
      errorMapper: (error) => new Error(`Failed to register tool ${name}: ${error instanceof Error ? error.message : String(error)}`),
      rethrow: true
    }
  );
}