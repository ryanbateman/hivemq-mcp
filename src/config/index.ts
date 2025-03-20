import { promises as fs } from "fs";
import path from "path";
import { BaseErrorCode, McpError } from "../types-global/errors.js";
import { ErrorHandler } from "../utils/errorHandler.js";
import { logger } from "../utils/logger.js";
import { sanitizeInput } from "../utils/security.js";
import { envConfig } from './envConfig.js';
import { enabledMcpServers, McpServerConfig, McpServersConfig } from './mcpConfig.js';

// Create a module-level logger for configuration
const configLogger = logger.createChildLogger({
  module: 'ConfigLoader'
});

// Default package info in case we can't load it
const DEFAULT_PACKAGE_INFO = {
  name: "mcp-template-server",
  version: "0.0.0"
};

// Maximum file size for package.json (5MB) to prevent potential DoS
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Load and parse the package.json file to get application information
 * 
 * @returns Promise resolving to object containing name and version from package.json
 */
async function loadPackageInfo(): Promise<{ name: string; version: string }> {
  try {
    // Get package info
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const sanitizedPath = sanitizeInput.path(pkgPath);
    
    configLogger.debug(`Loading package info from ${sanitizedPath}`);
    
    // Get file stats to check size before reading
    const stats = await fs.stat(sanitizedPath);
    
    // Check file size to prevent DoS attacks
    if (stats.size > MAX_FILE_SIZE) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `package.json file is too large (${stats.size} bytes)`,
        { path: sanitizedPath, maxSize: MAX_FILE_SIZE }
      );
    }
    
    // Use async file operations
    const pkgContent = await fs.readFile(sanitizedPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    
    // Validate expected fields
    if (!pkg.name || typeof pkg.name !== 'string') {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid package.json: missing or invalid name field',
        { path: sanitizedPath }
      );
    }
    
    if (!pkg.version || typeof pkg.version !== 'string') {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid package.json: missing or invalid version field',
        { path: sanitizedPath }
      );
    }
    
    configLogger.info(`Loaded application info`, {
      name: pkg.name,
      version: pkg.version
    });
    
    return {
      name: pkg.name,
      version: pkg.version
    };
  } catch (error) {
    // Log the error but don't rethrow
    try {
      ErrorHandler.handleError(error, {
        context: { path: path.resolve(process.cwd(), 'package.json') },
        operation: "loading package info"
      });
    } catch (handlerError) {
      // This shouldn't happen, but just in case
      configLogger.error("Error in error handler", { error: handlerError });
    }
    
    configLogger.error(`Failed to load package.json, using default values`, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Return default values
    return DEFAULT_PACKAGE_INFO;
  }
}

// Cache for package info
let cachedPackageInfo: { name: string; version: string } | null = null;

/**
 * Get package info, loading it on first call
 */
async function getPackageInfo(): Promise<{ name: string; version: string }> {
  if (!cachedPackageInfo) {
    cachedPackageInfo = await loadPackageInfo();
  }
  return cachedPackageInfo;
}

/**
 * Build the configuration info object with all loaded config combined
 * 
 * This function lazy-loads all configuration components when called.
 */
async function buildConfigInfo() {
  const packageInfo = await getPackageInfo();
  const env = envConfig();
  const servers = await enabledMcpServers();
  
  configLogger.info(`Building combined configuration object`, {
    environment: env.environment,
    packageName: packageInfo.name,
    mcpServerCount: Object.keys(servers).length
  });
  
  return {
    // Server info
    mcpServerName: packageInfo.name,
    mcpServerVersion: packageInfo.version,
    
    // Environment configuration
    ...env,

    // MCP servers configuration
    mcpServers: servers,
    
    // Debug info
    configLoadTime: new Date().toISOString()
  };
}

// Cache for config
let cachedConfig: Awaited<ReturnType<typeof buildConfigInfo>> | null = null;

// Export lazy-loading config function
export async function config() {
  if (!cachedConfig) {
    cachedConfig = await buildConfigInfo();
    
    // Log configuration summary
    configLogger.info(`Configuration loaded successfully`, {
      serverName: cachedConfig.mcpServerName,
      version: cachedConfig.mcpServerVersion,
      environment: cachedConfig.environment,
      enabledServers: Object.keys(cachedConfig.mcpServers)
    });
  }
  return cachedConfig;
}

// Export types and utilities
export { enabledMcpServers, getEnabledServers, getMcpConfig, isServerEnabled, loadMcpConfig } from './mcpConfig.js';
export type { McpServerConfig, McpServersConfig };
