import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
// Import utils from the main barrel file (logger, RequestContext, requestContextService from ../utils/internal/*)
import {
  logger,
  RequestContext,
  requestContextService,
} from "../utils/index.js";
// Import local McpError and BaseErrorCode
import { BaseErrorCode, McpError } from "../types-global/errors.js";

// --- Zod Schemas for Configuration Validation ---
// Ensures the configuration structure adheres to expected formats.

// Schema for environment variables passed to the server process (optional).
// Allows defining specific environment variables for each server.
const EnvSchema = z
  .record(z.string())
  .optional()
  .describe(
    "Optional key-value pairs for environment variables specific to the server process."
  );

// Schema for a single MCP server configuration entry within the main config file.
const McpServerConfigEntrySchema = z.object({
  // The command or script used to launch the MCP server process (e.g., 'node', '/path/to/server.py').
  // For HTTP transport, this field typically holds the base URL of the server.
  command: z
    .string()
    .min(1, "Server command or HTTP base URL cannot be empty"),
  // Arguments to pass to the server command (only applicable for stdio transport).
  args: z.array(z.string()).default([]),
  // Optional environment variables specific to this server process (merged with client's env).
  env: EnvSchema,
  // Specifies the communication method (stdio or http). Defaults to 'stdio'.
  transportType: z.enum(["stdio", "http"]).default("stdio"),
  // Optional fields for future use:
  // disabled: z.boolean().optional().describe("If true, this server configuration is ignored."),
  // autoApprove: z.boolean().optional().describe("If true, skip user approval prompts for this server (use with caution)."),
});
// Export the inferred type for use elsewhere.
export type McpServerConfigEntry = z.infer<typeof McpServerConfigEntrySchema>;

// Schema for the root structure of the mcp-config.json file.
// Expects a top-level key 'mcpServers' containing a map of server names to their configurations.
const McpClientConfigFileSchema = z.object({
  mcpServers: z.record(McpServerConfigEntrySchema),
});
// Export the inferred type for the entire config file structure.
export type McpClientConfigFile = z.infer<typeof McpClientConfigFileSchema>;

// --- Configuration Loading Logic ---

// Determine the directory of the current module to locate config files reliably.
const __dirname = dirname(fileURLToPath(import.meta.url));
// Define paths for the primary configuration file and the example fallback.
const primaryConfigPath = join(__dirname, "mcp-config.json");
const exampleConfigPath = join(__dirname, "mcp-config.json.example");

// Cache for the loaded configuration to avoid redundant file I/O and parsing.
let loadedConfig: McpClientConfigFile | null = null;
// Track which configuration file was successfully loaded (primary or example).
let loadedConfigPath: string | null = null;

/**
 * Loads, validates, and caches the MCP client configuration.
 * It first attempts to load from `mcp-config.json`. If that file doesn't exist
 * or fails to read, it falls back to loading `mcp-config.json.example`.
 * The loaded content is then parsed as JSON and validated against the Zod schema.
 *
 * @param parentContext - Optional parent request context for logging and tracing.
 * @returns The loaded and validated MCP server configurations object.
 * @throws McpError if neither config file can be read, parsed, or validated successfully.
 */
export function loadMcpClientConfig(
  parentContext?: RequestContext | null
): McpClientConfigFile {
  const context = requestContextService.createRequestContext({
    ...(parentContext ?? {}),
    operation: "loadMcpClientConfig",
  });

  // --- Return Cached Config (if available) ---
  if (loadedConfig && loadedConfigPath) {
    logger.debug(
      `Returning cached MCP client config from: ${loadedConfigPath}`,
      context
    );
    return loadedConfig;
  }

  let fileContent: string | null = null;
  let configPathToLog = ""; // Store the path of the file being processed for logging

  // --- 1. Attempt to Load Primary Config File ---
  if (existsSync(primaryConfigPath)) {
    logger.info(
      `Attempting to load primary MCP config: ${primaryConfigPath}`,
      context
    );
    try {
      fileContent = readFileSync(primaryConfigPath, "utf-8");
      configPathToLog = primaryConfigPath;
      logger.info(`Successfully read primary config file.`, {
        ...context,
        filePath: configPathToLog,
      });
    } catch (readError) {
      logger.warning(
        `Failed to read primary config file at ${primaryConfigPath}, attempting fallback.`,
        {
          ...context,
          filePath: primaryConfigPath,
          error:
            readError instanceof Error ? readError.message : String(readError),
        }
      );
      // Error reading primary file, proceed to fallback.
    }
  } else {
    logger.info(
      `Primary config file not found at ${primaryConfigPath}, attempting fallback.`,
      {
        ...context,
        filePath: primaryConfigPath,
      }
    );
    // Primary file doesn't exist, proceed to fallback.
  }

  // --- 2. Attempt to Load Example Config File (if primary failed) ---
  if (!fileContent) {
    if (existsSync(exampleConfigPath)) {
      logger.info(
        `Attempting to load example MCP config: ${exampleConfigPath}`,
        context
      );
      try {
        fileContent = readFileSync(exampleConfigPath, "utf-8");
        configPathToLog = exampleConfigPath;
        logger.info(`Successfully read example config file.`, {
          ...context,
          filePath: configPathToLog,
        });
      } catch (readError) {
        // If reading the example file also fails, it's a critical error.
        logger.error(`Failed to read example config file as well.`, {
          ...context,
          filePath: exampleConfigPath,
          error:
            readError instanceof Error ? readError.message : String(readError),
        });
        throw new McpError(
          BaseErrorCode.CONFIGURATION_ERROR,
          `Failed to read MCP client config: Neither ${primaryConfigPath} nor ${exampleConfigPath} could be read.`,
          { originalError: readError }
        );
      }
    } else {
      // If neither file exists, it's a critical error.
      logger.error(`Neither primary nor example config file found.`, {
        ...context,
        primaryPath: primaryConfigPath,
        examplePath: exampleConfigPath,
      });
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR,
        `MCP client config file not found: Looked for ${primaryConfigPath} and ${exampleConfigPath}.`
      );
    }
  }

  // --- 3. Parse and Validate JSON Content ---
  try {
    // Parse the raw file content into a JavaScript object.
    const parsedJson = JSON.parse(fileContent);
    // Validate the parsed object against the defined Zod schema.
    const validationResult = McpClientConfigFileSchema.safeParse(parsedJson);

    if (!validationResult.success) {
      // Validation failed; log the specific Zod errors.
      logger.error("MCP client configuration validation failed.", {
        ...context,
        filePath: configPathToLog,
        errors: validationResult.error.errors, // Detailed Zod error info
      });
      // Format Zod errors into a user-friendly message.
      const errorMessages = validationResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      throw new Error(`Validation failed: ${errorMessages}`); // Throw standard Error to be caught below
    }

    // --- Validation Successful ---
    // Cache the validated configuration and the path it was loaded from.
    loadedConfig = validationResult.data;
    loadedConfigPath = configPathToLog;

    logger.info(
      `MCP client configuration loaded and validated successfully from: ${loadedConfigPath}`,
      {
        ...context,
        serversFound: Object.keys(loadedConfig.mcpServers).length,
      }
    );

    // Return the validated configuration.
    return loadedConfig;
  } catch (error) {
    // Catch errors from JSON.parse or the Zod validation failure.
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to parse or validate MCP client configuration", {
      ...context,
      filePath: configPathToLog,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Throw a specific McpError indicating a configuration problem.
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      `Failed to load/validate MCP client config from ${configPathToLog}: ${errorMessage}`,
      { originalError: error }
    );
  }
}

/**
 * Retrieves the configuration entry for a specific MCP server by its name.
 * Ensures the main configuration is loaded (using the cached version if available)
 * before attempting to access the specific server's details.
 *
 * @param serverName - The name identifier of the server (key in the 'mcpServers' map).
 * @param parentContext - Optional parent request context for logging.
 * @returns A copy of the configuration entry for the specified server.
 * @throws McpError if the configuration hasn't been loaded or the server name is not found within the loaded config.
 */
export function getMcpServerConfig(
  serverName: string,
  parentContext?: RequestContext | null
): McpServerConfigEntry {
  const context = requestContextService.createRequestContext({
    ...(parentContext ?? {}),
    operation: "getMcpServerConfig",
    targetServer: serverName,
  });

  // Ensure the main config is loaded (uses cache or loads/validates).
  const config = loadMcpClientConfig(context);
  // Get the path from where the config was loaded for logging clarity.
  const configPath = loadedConfigPath || "unknown";

  // Attempt to retrieve the specific server's configuration.
  const serverConfig = config.mcpServers[serverName];

  if (!serverConfig) {
    // If the server name doesn't exist as a key in the config.
    logger.error(
      `Configuration for MCP server "${serverName}" not found in ${configPath}.`,
      context
    );
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      `Configuration for MCP server "${serverName}" not found in ${configPath}.`
    );
  }

  logger.debug(
    `Retrieved configuration for server "${serverName}" from ${configPath}`,
    context
  );
  // Return a shallow copy to prevent accidental modification of the cached configuration object.
  return { ...serverConfig };
}
