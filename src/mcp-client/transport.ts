import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // Corrected Import HTTP transport name
// Import utils from the main barrel file (logger, RequestContext, requestContextService from ../utils/internal/*)
import { BaseErrorCode, McpError } from "../types-global/errors.js";
import {
  logger,
  RequestContext,
  requestContextService,
} from "../utils/index.js";
import { getMcpServerConfig } from "./configLoader.js";

/**
 * Configuration options specifically required for creating a StdioClientTransport.
 * This includes the command to execute, arguments, and optional environment variables.
 */
interface StdioTransportConfig {
  command: string;
  args: string[];
  env?: Record<string, string>; // Environment variables for the server process
}

/**
 * Creates and configures a StdioClientTransport instance for launching and communicating
 * with an MCP server process via standard input/output.
 *
 * @param transportConfig - Configuration containing the command, args, and env for the server process.
 * @param parentContext - Optional parent request context for logging.
 * @returns A configured StdioClientTransport instance ready to be connected.
 * @throws McpError if the provided configuration is invalid or if the transport fails to initialize.
 */
export function createStdioClientTransport(
  transportConfig: StdioTransportConfig,
  parentContext?: RequestContext | null
): StdioClientTransport {
  const baseContext = parentContext ? { ...parentContext } : {};
  const context = requestContextService.createRequestContext({
    ...baseContext,
    operation: "createStdioClientTransport",
    transportType: "stdio",
    command: transportConfig.command,
  });

  logger.debug("Creating StdioClientTransport", context);

  // --- Input Validation ---
  if (!transportConfig.command || typeof transportConfig.command !== "string") {
    logger.error("Invalid command provided for StdioClientTransport", context);
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      "Invalid command for StdioClientTransport",
      context
    );
  }
  if (!Array.isArray(transportConfig.args)) {
    logger.error(
      "Invalid args provided for StdioClientTransport (must be an array)",
      context
    );
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      "Invalid args for StdioClientTransport (must be an array)",
      context
    );
  }

  try {
    // --- Environment Merging ---
    // Combine the client's current environment with server-specific variables from the config.
    // Server-specific variables take precedence.
    // Filter out undefined values from process.env to avoid potential issues.
    const filteredProcessEnv: Record<string, string> = {};
    for (const key in process.env) {
      if (
        Object.prototype.hasOwnProperty.call(process.env, key) &&
        process.env[key] !== undefined
      ) {
        filteredProcessEnv[key] = process.env[key] as string;
      }
    }

    const mergedEnv: Record<string, string> = {
      ...filteredProcessEnv, // Start with client's environment
      ...(transportConfig.env || {}), // Override/add server-specific env vars
    };

    logger.debug("Creating StdioClientTransport with merged environment", {
      ...context,
      envKeys: Object.keys(mergedEnv).length, // Log count for brevity
    });

    // --- Instantiate Transport ---
    // Create the transport instance, passing the command, args, and merged environment.
    const transport = new StdioClientTransport({
      command: transportConfig.command,
      args: transportConfig.args,
      env: mergedEnv,
    });

    logger.info("StdioClientTransport created successfully", context);
    return transport;
  } catch (error) {
    // Catch errors during transport instantiation (e.g., invalid command path).
    logger.error("Failed to create StdioClientTransport", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Re-throw as a specific McpError for consistent error handling.
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR, // Could potentially be CONFIGURATION_ERROR if command is invalid
      `Failed to create StdioClientTransport: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { originalError: error, ...context }
    );
  }
}

/**
 * Retrieves the server configuration and creates the appropriate client transport
 * (Stdio or HTTP) based on the `transportType` specified in the configuration.
 * This acts as a factory function for obtaining the correct transport instance.
 *
 * @param serverName - The name of the MCP server (key in mcp-config.json).
 * @param parentContext - Optional parent request context for logging.
 * @returns A configured transport instance (either StdioClientTransport or StreamableHTTPClientTransport).
 * @throws McpError if configuration is missing, invalid, specifies an unsupported transport type, or if transport creation fails.
 */
export function getClientTransport(
  serverName: string,
  parentContext?: RequestContext | null
): StdioClientTransport | StreamableHTTPClientTransport { // Use union type for specific return possibilities
  const baseContext = parentContext ? { ...parentContext } : {};
  const context = requestContextService.createRequestContext({
    ...baseContext,
    operation: "getClientTransport",
    targetServer: serverName,
  });

  logger.info(`Getting transport for server: ${serverName}`, context);

  try {
    // --- 1. Load Server Configuration ---
    // Retrieve the validated configuration for the specified server.
    const serverConfig = getMcpServerConfig(serverName, context);

    // --- 2. Determine and Create Transport ---
    const transportType = serverConfig.transportType; // Already defaulted to 'stdio' by config loader if missing
    logger.info(
      `Selected transport type "${transportType}" for server: ${serverName}`,
      { ...context, transportType }
    );

    if (transportType === "stdio") {
      // --- Create Stdio Transport ---
      logger.info(`Creating stdio transport for server: ${serverName}`, {
        ...context,
        command: serverConfig.command,
        args: serverConfig.args,
        envProvided: !!serverConfig.env,
      });
      // Delegate to the dedicated stdio creation function.
      return createStdioClientTransport(
        {
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env, // Pass validated env config
        },
        context
      );
    } else if (transportType === "http") {
      // --- Create HTTP Transport ---
      // For HTTP, the 'command' field in the config is interpreted as the base URL.
      const baseUrl = serverConfig.command;
      // Validate that the command field looks like a URL for HTTP transport.
      if (
        !baseUrl ||
        typeof baseUrl !== "string" ||
        !baseUrl.startsWith("http")
      ) {
        const httpConfigError = `Invalid configuration for HTTP transport server "${serverName}": The 'command' field must be a valid base URL (e.g., "http://localhost:3001"). Found: "${baseUrl}"`;
        logger.error(httpConfigError, context);
        throw new McpError(
          BaseErrorCode.CONFIGURATION_ERROR,
          httpConfigError,
          context
        );
      }

      logger.info(
        `Creating HTTP transport for server: ${serverName} with base URL: ${baseUrl}`,
        context
      );

      try {
        // Instantiate the StreamableHTTPClientTransport using the base URL.
        // The SDK handles constructing the full /mcp endpoint path.
        // IMPORTANT: Authentication headers (e.g., Authorization: Bearer <token>)
        // need to be added here or via client options if required by the server,
        // following the MCP Authentication Specification.
        const transportOptions = {
          // Example: Adding authentication headers if needed
          // headers: {
          //   'Authorization': `Bearer ${getAuthTokenForServer(serverName)}`
          // }
        };
        const transport = new StreamableHTTPClientTransport(
          new URL(baseUrl),
          transportOptions // Pass options if needed
        );

        logger.info(
          `StreamableHTTPClientTransport created successfully for ${serverName}`,
          context
        );
        return transport;
      } catch (error) {
        // Catch errors during HTTP transport instantiation (e.g., invalid URL format).
        logger.error(
          `Failed to create StreamableHttpClientTransport for ${serverName}`,
          {
            ...context,
            baseUrl: baseUrl,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
        throw new McpError(
          BaseErrorCode.INTERNAL_ERROR, // Or CONFIGURATION_ERROR if URL is invalid
          `Failed to create HTTP transport for ${serverName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { originalError: error, ...context }
        );
      }
    } else {
      // --- Unsupported Transport Type ---
      // This path should ideally not be reachable due to Zod validation in the config loader.
      const unsupportedErrorMessage = `Unsupported transportType "${serverConfig.transportType}" configured for server "${serverName}".`;
      logger.error(unsupportedErrorMessage, context);
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR,
        unsupportedErrorMessage,
        context
      );
    }
  } catch (error) {
    // Catch errors from config loading or transport creation steps.
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to get or create transport for server "${serverName}"`,
      {
        ...context,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      }
    );

    // Ensure a consistent McpError is thrown.
    if (error instanceof McpError) {
      throw error;
    } else {
      // Assume configuration error if not already an McpError
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR,
        `Failed to initialize transport for ${serverName}: ${errorMessage}`,
        { originalError: error }
      );
    }
  }
}
