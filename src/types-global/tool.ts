import { z } from 'zod';
import { RateLimitConfig } from "../utils/rateLimiter.js"; // Add .js
import { OperationContext } from "../utils/security.js"; // Add .js
import { ErrorHandler } from "../utils/errorHandler.js"; // Add .js
import { logger } from "../utils/logger.js"; // Add .js

// Define context for this module
const toolModuleContext = {
  module: 'ToolRegistration'
};

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
  server: any,  // Using any to avoid type conflicts with McpServer potentially
  name: string, 
  description: string, 
  inputSchema: Record<string, z.ZodType<any>>, 
  handler: (input: unknown, context: OperationContext) => Promise<unknown>,
  metadata?: ToolMetadata  
): Promise<void> {
  const registrationContext = { ...toolModuleContext, toolName: name };
  
  return ErrorHandler.tryCatch<void>(
    async () => {
      // Log the registration attempt
      logger.info(`Registering tool: ${name}`, {
        ...registrationContext,
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

      // Convert schema to a more standardized format if needed for logging
      const schemaDescription = Object.entries(inputSchema).map(([key, schema]) => {
        const description = schema.description;
        // Check if the schema is optional using Zod's introspection
        const isRequired = !(schema instanceof z.ZodOptional || schema instanceof z.ZodDefault); 
        return `${key}${isRequired ? ' (required)' : ''}: ${description || 'No description'}`;
      }).join('\n');

      logger.debug(`Tool ${name} schema:`, {
        ...registrationContext,
        schema: schemaDescription
      });

      // Actually register the tool with the server
      // Check if it's an McpServer instance with tool() method
      if (server.tool && typeof server.tool === 'function') {
        // Use the McpServer.tool() method directly
        logger.debug('Using McpServer.tool() method', registrationContext);
        server.tool(name, inputSchema, handler, {
          description,
          examples: metadata?.examples
        });
      } else {
        // For other server types or for testing, log a warning
        logger.warn(`Unable to register tool ${name} with server - missing tool() method`, registrationContext);
      }

      // Log successful registration
      logger.info(`Tool ${name} registered successfully`, registrationContext);
    },
    {
      context: registrationContext, // Pass context to ErrorHandler
      operation: "registering tool",
      errorMapper: (error) => new Error(`Failed to register tool ${name}: ${error instanceof Error ? error.message : String(error)}`),
      rethrow: true
    }
  );
}
