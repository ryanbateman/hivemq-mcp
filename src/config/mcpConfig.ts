import { promises as fs } from 'fs';
import path from 'path';
import { BaseErrorCode, McpError } from '../types-global/errors.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sanitizeInput } from '../utils/security.js';

/**
 * MCP Server Configuration Interface
 */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  alwaysAllow?: string[];
}

/**
 * MCP Servers Configuration Interface
 */
export interface McpServersConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Default path to the MCP servers configuration file
 */
const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'mcp-servers.json');

// Maximum config file size (5MB) to prevent potential DoS
const MAX_CONFIG_FILE_SIZE = 5 * 1024 * 1024;

// Create a module-level logger with context
const configLogger = logger.createChildLogger({
  module: 'MCPServerConfig',
  configPath: DEFAULT_CONFIG_PATH
});

/**
 * Load and parse the MCP servers configuration from the specified file
 * 
 * @param configPath - Path to the configuration file
 * @returns The parsed configuration
 * @throws {McpError} When configuration is invalid or cannot be loaded
 */
export async function loadMcpConfig(configPath: string = DEFAULT_CONFIG_PATH): Promise<McpServersConfig> {
  // Sanitize the config path
  const safePath = sanitizeInput.path(configPath);
  
  configLogger.info(`Loading MCP server configurations from ${safePath}`);
  
  // Create a local context for this particular config load
  const localContext = {
    configPath: safePath,
    timestamp: new Date().toISOString()
  };

  try {
    // Check if the file exists
    try {
      await fs.access(safePath);
    } catch (error) {
      configLogger.warn(`MCP servers configuration file not found`, localContext);
      
      // For non-existent files, return empty config but don't throw an error
      return { mcpServers: {} };
    }

    // Check file size before reading
    const stats = await fs.stat(safePath);
    
    if (stats.size > MAX_CONFIG_FILE_SIZE) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `MCP servers configuration file is too large (${stats.size} bytes)`,
        { configPath: safePath, maxSize: MAX_CONFIG_FILE_SIZE }
      );
    }
    
    // Read the file
    const configContent = await fs.readFile(safePath, 'utf-8');
    
    // Parse and validate the content
    let parsedConfig: any;
    try {
      parsedConfig = JSON.parse(configContent);
    } catch (parseError) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid JSON in MCP servers configuration: ${parseError instanceof Error ? parseError.message : 'parsing error'}`,
        { configPath: safePath, contentLength: configContent.length }
      );
    }
    
    // Validate the configuration structure
    if (!parsedConfig || typeof parsedConfig !== 'object') {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid MCP servers configuration: not an object',
        { configType: typeof parsedConfig }
      );
    }
    
    if (!parsedConfig.mcpServers || typeof parsedConfig.mcpServers !== 'object') {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid MCP servers configuration: missing mcpServers object',
        { keys: Object.keys(parsedConfig) }
      );
    }
    
    const config = parsedConfig as McpServersConfig;
    
    // Validate each server configuration
    validateServerConfigs(config.mcpServers);
    
    // Log the loaded configuration
    const serverCount = Object.keys(config.mcpServers).length;
    configLogger.info(`Loaded ${serverCount} MCP server configurations`, {
      ...localContext,
      serverCount,
      serverNames: Object.keys(config.mcpServers)
    });
    
    return config;
  } catch (error) {
    // Log the error
    ErrorHandler.handleError(error, {
      context: { configPath: safePath },
      operation: "loading MCP server configurations"
    });
    
    // Propagate configuration errors - critical failures
    // Only throw for certain error types - missing file is not considered critical
    if (error instanceof McpError && 
        error.code !== BaseErrorCode.NOT_FOUND) {
      throw error;
    }
    
    // Return empty config only for non-critical errors like missing files
    configLogger.warn("Returning empty MCP server configuration due to error");
    return { mcpServers: {} };
  }
}

/**
 * Validate server configurations
 * 
 * @param serverConfigs - The server configurations to validate
 * @throws {McpError} If any server configuration is invalid
 */
function validateServerConfigs(serverConfigs: Record<string, McpServerConfig>): void {
  Object.entries(serverConfigs).forEach(([name, config]) => {
    // Check required fields
    if (!config.command) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid MCP server configuration for '${name}': missing command`,
        { serverName: name }
      );
    }
    
    if (!Array.isArray(config.args)) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid MCP server configuration for '${name}': args must be an array`,
        { serverName: name, argsType: typeof config.args }
      );
    }
    
    // Ensure env is an object if provided
    if (config.env !== undefined && (typeof config.env !== 'object' || Array.isArray(config.env))) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid MCP server configuration for '${name}': env must be an object`,
        { serverName: name, envType: typeof config.env }
      );
    }
    
    // Ensure alwaysAllow is an array if provided
    if (config.alwaysAllow !== undefined && !Array.isArray(config.alwaysAllow)) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid MCP server configuration for '${name}': alwaysAllow must be an array`,
        { serverName: name, alwaysAllowType: typeof config.alwaysAllow }
      );
    }
    
    configLogger.debug(`Validated server configuration for '${name}'`, {
      command: config.command,
      argsCount: config.args.length,
      hasEnv: !!config.env,
      disabled: !!config.disabled
    });
  });
}

/**
 * Check if a server is enabled
 * 
 * @param serverConfig - The server configuration
 * @param serverName - The name of the server (for logging)
 * @returns Whether the server is enabled
 */
export function isServerEnabled(serverConfig: McpServerConfig, serverName?: string): boolean {
  const enabled = serverConfig.disabled !== true;
  
  if (!enabled && serverName) {
    configLogger.debug(`MCP server is disabled`, { serverName });
  }
  
  return enabled;
}

/**
 * Get a list of enabled MCP servers
 * 
 * @param config - The MCP servers configuration
 * @returns A map of enabled server names to their configurations
 */
export async function getEnabledServers(config: McpServersConfig): Promise<Record<string, McpServerConfig>> {
  try {
    const enabledServers: Record<string, McpServerConfig> = {};
    
    const allServerCount = Object.keys(config.mcpServers).length;
    configLogger.info(`Filtering enabled MCP servers from ${allServerCount} configurations`);
    
    // Create an array of server entries
    const entries = Object.entries(config.mcpServers);
    
    // Process each server configuration
    for (const [name, serverConfig] of entries) {
      // Sanitize server name 
      const safeName = sanitizeInput.string(name);
      
      if (isServerEnabled(serverConfig, safeName)) {
        enabledServers[safeName] = serverConfig;
        configLogger.debug(`MCP server enabled: ${safeName}`, {
          command: serverConfig.command,
          args: serverConfig.args
        });
      } else {
        configLogger.info(`MCP server disabled: ${safeName}`);
      }
    }
    
    const enabledCount = Object.keys(enabledServers).length;
    configLogger.info(`Filtered ${enabledCount} enabled MCP servers out of ${allServerCount} total`, {
      enabledServers: Object.keys(enabledServers)
    });
    
    return enabledServers;
  } catch (error) {
    // Log the error but don't swallow it for critical errors
    const handledError = ErrorHandler.handleError(error, {
      operation: "filtering enabled MCP servers"
    });
    
    // For critical errors, propagate them
    if (handledError instanceof McpError && 
        handledError.code !== BaseErrorCode.NOT_FOUND) {
      throw handledError;
    }
    
    // Return empty object on non-critical errors
    configLogger.warn("Returning empty enabled servers map due to error");
    return {};
  }
}

// DO NOT LOAD CONFIG AT IMPORT TIME
// Instead, provide functions that load config on demand

// Cached configuration to avoid loading multiple times
let cachedConfig: McpServersConfig | null = null;
let cachedEnabledServers: Record<string, McpServerConfig> | null = null;

/**
 * Get the MCP server configuration, loading it on first call
 */
export async function getMcpConfig(): Promise<McpServersConfig> {
  if (!cachedConfig) {
    cachedConfig = await loadMcpConfig();
  }
  return cachedConfig;
}

/**
 * Get the enabled MCP servers, loading them on first call
 */
export const enabledMcpServers = async (): Promise<Record<string, McpServerConfig>> => {
  if (!cachedEnabledServers) {
    const config = await getMcpConfig();
    cachedEnabledServers = await getEnabledServers(config);
  }
  return cachedEnabledServers;
};