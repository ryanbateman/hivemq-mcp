import dotenv from "dotenv";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { logger, McpLogLevel } from "../utils/logger.js"; // Import McpLogLevel and logger

dotenv.config(); // Load environment variables from .env file

// Determine the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));
// Construct the path to package.json relative to the current file
const pkgPath = join(__dirname, '../../package.json');
// Default package information in case package.json is unreadable
let pkg = { name: 'mcp-ts-template', version: '0.0.0' };

try {
  // Read and parse package.json to get server name and version
  pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
} catch (error) {
  // Silently use default pkg info if reading fails. Error will be logged later if needed.
}

/**
 * Main application configuration object.
 * Aggregates settings from environment variables and package.json.
 */
export const config = {
  /** The name of the MCP server, derived from package.json. */
  mcpServerName: pkg.name,
  /** The version of the MCP server, derived from package.json. */
  mcpServerVersion: pkg.version,
  /** Logging level for the application (e.g., "debug", "info", "warning", "error"). Defaults to "info". */
  logLevel: process.env.MCP_LOG_LEVEL || "info", // Use MCP_LOG_LEVEL consistently
  /** The runtime environment (e.g., "development", "production"). Defaults to "development". */
  environment: process.env.NODE_ENV || "development",
  /** Security-related configurations. */
  security: {
    // Placeholder for security settings
    // Example: authRequired: process.env.AUTH_REQUIRED === 'true'
    /** Indicates if authentication is required for server operations. */
    authRequired: false,
  }
  // Note: mcpClient configuration is now loaded separately from mcp-config.json
};

/**
 * The configured logging level for the application.
 * Exported separately for convenience (e.g., logger initialization).
 * @type {string}
 */
export const logLevel = config.logLevel;

/**
 * The configured runtime environment for the application.
 * Exported separately for convenience.
 * @type {string}
 */
export const environment = config.environment;

// Define valid MCP log levels based on the logger's type definition
const validMcpLogLevels: McpLogLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'crit', 'alert', 'emerg'];

// Validate the configured log level
let validatedMcpLogLevel: McpLogLevel = 'info'; // Default to 'info'
if (validMcpLogLevels.includes(logLevel as McpLogLevel)) {
  validatedMcpLogLevel = logLevel as McpLogLevel;
} else {
  // Silently default to 'info' if the configured level is invalid.
  // The logger initialization message will show the actual level being used.
}

// Initialize the logger with the validated MCP level AFTER config is defined.
logger.initialize(validatedMcpLogLevel);

// Log initialization message using the logger itself (will go to file and potentially MCP)
logger.info(`Logger initialized. MCP logging level: ${validatedMcpLogLevel}`);
logger.debug("Configuration loaded successfully", { config }); // Log loaded config at debug level
