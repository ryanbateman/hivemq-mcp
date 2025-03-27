import dotenv from "dotenv";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js"; // Added .js extension

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '../../package.json');
let pkg = { name: 'unknown-package', version: '0.0.0' }; // Default package info

try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
} catch (error) {
  logger.error(`Failed to read or parse package.json at ${pkgPath}`, { 
    error: error instanceof Error ? error.message : String(error) 
  });
  // Continue with default pkg info
}

// Define and export the main configuration object
export const config = {
  mcpServerName: pkg.name,
  mcpServerVersion: pkg.version,
  logLevel: process.env.LOG_LEVEL || "info",
  environment: process.env.NODE_ENV || "development",
  security: {
    // Placeholder for security settings
    // Example: authRequired: process.env.AUTH_REQUIRED === 'true'
    authRequired: false,
  }
};

// Export log level separately for convenience if needed elsewhere (like logger setup)
export const logLevel = config.logLevel;
export const environment = config.environment;

// Initialize the logger with the configured level AFTER config is defined
logger.initialize(logLevel as "debug" | "info" | "warn" | "error");
