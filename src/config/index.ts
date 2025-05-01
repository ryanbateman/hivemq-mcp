import dotenv from "dotenv";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

// REMOVED: Logger initialization and validation logic.
// This will now happen at the very start of src/index.ts.
