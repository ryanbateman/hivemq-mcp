import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import { ErrorHandler } from "../../utils/errorHandler.js";
import { ChildLogger, logger } from "../../utils/logger.js";

/**
 * Base interface for registration options
 */
export interface RegistrationOptions {
  /** Name of the component being registered */
  name: string;
  /** Logger context for creating a child logger */
  loggerContext?: Record<string, unknown>;
}

/**
 * Full options with component type
 */
interface InternalRegistrationOptions extends RegistrationOptions {
  /** Type of component (tool, resource, etc.) */
  type: string;
}

/**
 * Helper for consistent registration pattern with proper error handling
 * @param server MCP server instance
 * @param options Registration options
 * @param registerFn Function that performs the actual registration
 * @returns Promise resolving when registration is complete
 */
export async function registerComponent(
  server: McpServer,
  options: InternalRegistrationOptions,
  registerFn: (server: McpServer, childLogger: ChildLogger) => Promise<void>
): Promise<void> {
  // Create a component-specific logger
  const componentLogger = logger.createChildLogger({
    module: `${options.type}Registration`,
    componentName: options.name,
    ...options.loggerContext
  });

  componentLogger.info(`Registering ${options.type}: ${options.name}`);
  
  // Use ErrorHandler.tryCatch for consistent error handling
  return await ErrorHandler.tryCatch(
    async () => {
      // Call the registration function
      await registerFn(server, componentLogger);
      
      componentLogger.info(`${options.type} registered successfully: ${options.name}`);
    },
    {
      operation: `registering ${options.type}`,
      // Provide context for better error tracking
      context: {
        componentType: options.type,
        componentName: options.name
      },
      // Use a specific error code for registration failures
      errorCode: BaseErrorCode.INTERNAL_ERROR,
      // Custom error mapper for clearer error messages
      errorMapper: (error) => new McpError(
        error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR,
        `Failed to register ${options.type} '${options.name}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        { componentType: options.type, componentName: options.name }
      ),
      // Registration errors are considered critical
      critical: true
    }
  );
}

/**
 * Register a tool with the MCP server using a consistent pattern
 * @param server MCP server instance
 * @param options Tool registration options
 * @param handlerFn Function that sets up the tool handler
 * @returns Promise resolving when registration is complete
 */
export async function registerTool(
  server: McpServer,
  options: RegistrationOptions,
  handlerFn: (server: McpServer, logger: ChildLogger) => Promise<void>
): Promise<void> {
  return registerComponent(
    server,
    { ...options, type: 'tool' },
    handlerFn
  );
}

/**
 * Register a resource with the MCP server using a consistent pattern
 * @param server MCP server instance
 * @param options Resource registration options
 * @param handlerFn Function that sets up the resource handler
 * @returns Promise resolving when registration is complete
 */
export async function registerResource(
  server: McpServer,
  options: RegistrationOptions,
  handlerFn: (server: McpServer, logger: ChildLogger) => Promise<void>
): Promise<void> {
  return registerComponent(
    server,
    { ...options, type: 'resource' },
    handlerFn
  );
}

export default {
  registerComponent,
  registerTool,
  registerResource
};