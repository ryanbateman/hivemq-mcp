import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // Corrected Import HTTP transport name
// Import utils from the main barrel file (logger, RequestContext, requestContextService from ../utils/internal/*)
import { BaseErrorCode, McpError } from "../types-global/errors.js";
import { logger, RequestContext, requestContextService } from "../utils/index.js";
import { getMcpServerConfig } from "./configLoader.js";

/**
 * Configuration options for creating a StdioClientTransport.
 */
interface StdioTransportConfig {
  command: string;
  args: string[];
  env?: Record<string, string>; // Added env property
}

/**
 * Creates and configures a StdioClientTransport instance.
 *
 * @param transportConfig - Configuration for the stdio transport.
 * @param parentContext - Optional parent request context for logging.
 * @returns A configured StdioClientTransport instance.
 * @throws McpError if configuration is invalid or transport creation fails.
 */
export function createStdioClientTransport(
  transportConfig: StdioTransportConfig,
  parentContext?: RequestContext | null
): StdioClientTransport {
  const baseContext = parentContext ? { ...parentContext } : {};
  const context = requestContextService.createRequestContext({
    ...baseContext,
    operation: 'createStdioClientTransport',
    transportType: 'stdio',
    command: transportConfig.command,
  });

  logger.debug("Creating StdioClientTransport", context);

  if (!transportConfig.command || typeof transportConfig.command !== 'string') {
    logger.error("Invalid command provided for StdioClientTransport", context);
    throw new McpError(BaseErrorCode.CONFIGURATION_ERROR, "Invalid command for StdioClientTransport", context);
  }
  if (!Array.isArray(transportConfig.args)) {
    logger.error("Invalid args provided for StdioClientTransport (must be an array)", context);
    throw new McpError(BaseErrorCode.CONFIGURATION_ERROR, "Invalid args for StdioClientTransport (must be an array)", context);
  }

  try {
    // Merge process.env with server-specific env vars from config
    // Config env vars take precedence over process.env
    // Filter out undefined values from process.env
    const filteredProcessEnv: Record<string, string> = {};
    for (const key in process.env) {
      if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== undefined) {
        filteredProcessEnv[key] = process.env[key] as string;
      }
    }

    const mergedEnv: Record<string, string> = {
      ...filteredProcessEnv,
      ...(transportConfig.env || {}), // Use provided env, default to empty object if undefined
    };

    logger.debug("Creating StdioClientTransport with merged environment", { ...context, envKeys: Object.keys(mergedEnv).length }); // Log count for brevity

    const transport = new StdioClientTransport({
      command: transportConfig.command,
      args: transportConfig.args,
      env: mergedEnv, // Pass the merged environment variables
    });

    logger.info("StdioClientTransport created successfully", context);
    return transport;
  } catch (error) {
    logger.error("Failed to create StdioClientTransport", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Re-throw as McpError
     throw new McpError(
       BaseErrorCode.INTERNAL_ERROR, // Or TRANSPORT_ERROR?
       `Failed to create StdioClientTransport: ${error instanceof Error ? error.message : String(error)}`,
       { originalError: error, ...context }
     );
  }
}

/**
 * Retrieves and creates the appropriate client transport based on the configuration
 * for a specific MCP server. Supports 'stdio' and 'http'.
 *
 * @param serverName - The name of the MCP server to get the transport for.
 * @param parentContext - Optional parent request context for logging.
 * @returns A configured transport instance (StdioClientTransport or StreamableHTTPClientTransport).
 * @throws McpError if configuration is missing, invalid, or transport creation fails.
 */
export function getClientTransport(serverName: string, parentContext?: RequestContext | null): StdioClientTransport | StreamableHTTPClientTransport { // Return explicit union type
  const baseContext = parentContext ? { ...parentContext } : {};
  const context = requestContextService.createRequestContext({
    ...baseContext,
    operation: 'getClientTransport',
    targetServer: serverName,
  });

  logger.info(`Getting transport for server: ${serverName}`, context);

  try {
    // Load the specific server's configuration using the loader
    const serverConfig = getMcpServerConfig(serverName, context);

    // Determine the transport type from config (already defaulted to 'stdio' by loader)
    const transportType = serverConfig.transportType;
    logger.info(`Selected transport type "${transportType}" for server: ${serverName}`, { ...context, transportType });

    if (transportType === 'stdio') {
      // --- Create Stdio Transport ---
      logger.info(`Creating stdio transport for server: ${serverName}`, {
        ...context,
        command: serverConfig.command,
        args: serverConfig.args,
        envProvided: !!serverConfig.env,
      });

      // Pass the full config needed for stdio
      const transport = createStdioClientTransport(
        {
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env, // Pass env from the validated config
        },
        context
      );
      return transport;

    } else if (transportType === 'http') {
      // --- Create HTTP Transport ---
      // Assumption: For HTTP, the 'command' field in the config holds the base URL.
      const baseUrl = serverConfig.command;
      if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.startsWith('http')) {
         const httpConfigError = `Invalid configuration for HTTP transport server "${serverName}": The 'command' field must be a valid base URL (e.g., "http://localhost:3001"). Found: "${baseUrl}"`;
         logger.error(httpConfigError, context);
         throw new McpError(BaseErrorCode.CONFIGURATION_ERROR, httpConfigError, context);
      }

      logger.info(`Creating HTTP transport for server: ${serverName} with base URL: ${baseUrl}`, context);

      try {
        // Use StreamableHTTPClientTransport from the SDK (Corrected Name)
        // Pass a new URL object created from the baseUrl string
        const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
        // If the constructor requires an options object with headers, etc., it would look like:
        // const transport = new StreamableHTTPClientTransport({
        //   baseUrl: baseUrl,
        //   headers: serverConfig.httpHeaders || {}, // Example
        // });
        // Assuming the simple constructor for now based on the error.

        logger.info(`StreamableHTTPClientTransport created successfully for ${serverName}`, context); // Corrected log message class name
        return transport;
      } catch (error) {
        logger.error(`Failed to create StreamableHttpClientTransport for ${serverName}`, {
          ...context,
          baseUrl: baseUrl,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw new McpError(
          BaseErrorCode.INTERNAL_ERROR, // Or TRANSPORT_ERROR?
          `Failed to create HTTP transport for ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
          { originalError: error, ...context }
        );
      }

    } else {
      // --- Unsupported Transport Type ---
      // This case should theoretically not be reached due to Zod validation in configLoader,
      // but kept for robustness.
      const unsupportedErrorMessage = `Unsupported transportType "${serverConfig.transportType}" configured for server "${serverName}".`;
      logger.error(unsupportedErrorMessage, context);
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR,
        unsupportedErrorMessage,
        context
      );
    }

  } catch (error) {
    // Log the error encountered during config loading or transport creation
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get or create transport for server "${serverName}"`, {
      ...context,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Re-throw as a specific McpError if it's not already one
    if (error instanceof McpError) {
      throw error;
    } else {
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR, // Or INTERNAL_ERROR depending on context
        `Failed to initialize transport for ${serverName}: ${errorMessage}`,
        { originalError: error }
      );
    }
  }
}
