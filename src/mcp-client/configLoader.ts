import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { logger } from "../utils/logger.js";
// Import RequestContext type directly
import { RequestContext, requestContextService } from "../utils/requestContext.js";
// Import local McpError and BaseErrorCode
import { BaseErrorCode, McpError } from "../types-global/errors.js";

// --- Zod Schemas for Validation ---

// Schema for environment variables (optional record of string key-value pairs)
const EnvSchema = z.record(z.string()).optional();

// Schema for a single server configuration entry
const McpServerConfigEntrySchema = z.object({
  command: z.string().min(1, "Server command cannot be empty"),
  args: z.array(z.string()).default([]),
  env: EnvSchema,
  transportType: z.enum(["stdio", "http"]).default("stdio"), // Default to stdio if not specified
  // Add other potential fields like 'disabled', 'autoApprove' if needed later
  // disabled: z.boolean().optional(),
  // autoApprove: z.boolean().optional(),
});
export type McpServerConfigEntry = z.infer<typeof McpServerConfigEntrySchema>;

// Schema for the entire config file structure
const McpClientConfigFileSchema = z.object({
  mcpServers: z.record(McpServerConfigEntrySchema),
});
export type McpClientConfigFile = z.infer<typeof McpClientConfigFileSchema>;

// --- Configuration Loading Logic ---

// Determine the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));
// Construct paths to the primary config file and the example fallback
const primaryConfigPath = join(__dirname, 'mcp-config.json');
const exampleConfigPath = join(__dirname, 'mcp-config.json.example');

let loadedConfig: McpClientConfigFile | null = null;
let loadedConfigPath: string | null = null; // Track which file was loaded

/**
 * Loads and validates the MCP client configuration from mcp-config.json,
 * falling back to mcp-config.json.example if the primary file is not found.
 * Caches the loaded configuration to avoid repeated file reads and validation.
 *
 * @param parentContext - Optional parent request context for logging.
 * @returns The loaded and validated MCP server configurations.
 * @throws McpError if neither config file can be read, parsed, or validated.
 */
export function loadMcpClientConfig(parentContext?: RequestContext | null): McpClientConfigFile {
  const context = requestContextService.createRequestContext({
    ...(parentContext ?? {}),
    operation: 'loadMcpClientConfig',
  });

  // Return cached config if already loaded
  if (loadedConfig && loadedConfigPath) {
    logger.debug(`Returning cached MCP client config from: ${loadedConfigPath}`, context);
    return loadedConfig;
  }

  let fileContent: string | null = null;
  let configPathToLog = '';

  // 1. Try loading the primary config file
  if (existsSync(primaryConfigPath)) {
    logger.info(`Attempting to load primary MCP config: ${primaryConfigPath}`, context);
    try {
      fileContent = readFileSync(primaryConfigPath, 'utf-8');
      configPathToLog = primaryConfigPath;
      logger.info(`Successfully read primary config file.`, { ...context, filePath: configPathToLog });
    } catch (readError) {
      logger.warning(`Failed to read primary config file at ${primaryConfigPath}, attempting fallback.`, {
        ...context,
        filePath: primaryConfigPath,
        error: readError instanceof Error ? readError.message : String(readError),
      });
      // Proceed to fallback
    }
  } else {
    logger.info(`Primary config file not found at ${primaryConfigPath}, attempting fallback.`, {
      ...context,
      filePath: primaryConfigPath,
    });
  }

  // 2. Try loading the example config file if primary failed or didn't exist
  if (!fileContent) {
    if (existsSync(exampleConfigPath)) {
      logger.info(`Attempting to load example MCP config: ${exampleConfigPath}`, context);
      try {
        fileContent = readFileSync(exampleConfigPath, 'utf-8');
        configPathToLog = exampleConfigPath;
        logger.info(`Successfully read example config file.`, { ...context, filePath: configPathToLog });
      } catch (readError) {
        logger.error(`Failed to read example config file as well.`, {
          ...context,
          filePath: exampleConfigPath,
          error: readError instanceof Error ? readError.message : String(readError),
        });
        // Throw error as both attempts failed
        throw new McpError(
          BaseErrorCode.CONFIGURATION_ERROR,
          `Failed to read MCP client config: Neither ${primaryConfigPath} nor ${exampleConfigPath} could be read.`,
          { originalError: readError }
        );
      }
    } else {
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

  // 3. Parse and Validate the loaded content
  try {
    const parsedJson = JSON.parse(fileContent);
    const validationResult = McpClientConfigFileSchema.safeParse(parsedJson);

    if (!validationResult.success) {
      logger.error("MCP client configuration validation failed.", {
        ...context,
        filePath: configPathToLog,
        errors: validationResult.error.errors, // Log Zod errors
      });
      // Combine Zod error messages for a clearer error
      const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new Error(`Validation failed: ${errorMessages}`);
    }

    // Validation successful
    loadedConfig = validationResult.data;
    loadedConfigPath = configPathToLog; // Cache the path of the successfully loaded file

    logger.info(`MCP client configuration loaded and validated successfully from: ${loadedConfigPath}`, {
      ...context,
      serversFound: Object.keys(loadedConfig.mcpServers).length,
    });

    return loadedConfig;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to parse or validate MCP client configuration", {
      ...context,
      filePath: configPathToLog,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Throw a specific MCP error
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      `Failed to load/validate MCP client config from ${configPathToLog}: ${errorMessage}`,
      { originalError: error }
    );
  }
}

/**
 * Retrieves the configuration for a specific MCP server by name.
 * Ensures the configuration is loaded before attempting retrieval.
 *
 * @param serverName - The name of the server to retrieve configuration for.
 * @param parentContext - Optional parent request context for logging.
 * @returns The configuration entry for the specified server.
 * @throws McpError if the configuration hasn't been loaded or the server name is not found.
 */
export function getMcpServerConfig(serverName: string, parentContext?: RequestContext | null): McpServerConfigEntry {
  const context = requestContextService.createRequestContext({
    ...(parentContext ?? {}),
    operation: 'getMcpServerConfig',
    targetServer: serverName,
  });

  // Ensure config is loaded (will use cache or load/validate)
  const config = loadMcpClientConfig(context);
  const configPath = loadedConfigPath || 'unknown'; // Get the path used

  const serverConfig = config.mcpServers[serverName];

  if (!serverConfig) {
    logger.error(`Configuration for MCP server "${serverName}" not found in ${configPath}.`, context);
    throw new McpError(
      BaseErrorCode.CONFIGURATION_ERROR,
      `Configuration for MCP server "${serverName}" not found in ${configPath}.`
    );
  }

  logger.debug(`Retrieved configuration for server "${serverName}" from ${configPath}`, context);
  // Return a copy to prevent accidental modification of the cached config
  return { ...serverConfig };
}
