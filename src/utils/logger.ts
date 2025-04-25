import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import winston from "winston";
// Removed import of config to break circular dependency

type LogLevel = "debug" | "info" | "warn" | "error";

// Handle ESM module dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve logs directory relative to project root (2 levels up from utils/)
const projectRoot = path.resolve(__dirname, '..', '..');
const logsDir = path.join(projectRoot, 'logs');

// --- Security Check for Logs Directory ---
// Ensure the resolved logs directory is within the project root.
const resolvedLogsDir = path.resolve(logsDir);
let isLogsDirSafe = false;
if (resolvedLogsDir.startsWith(projectRoot + path.sep) || resolvedLogsDir === projectRoot) {
    isLogsDirSafe = true;
} else {
    // Use console.error for critical pre-initialization errors
    console.error(`FATAL: Calculated logs directory "${resolvedLogsDir}" is outside the project root "${projectRoot}". Logging to files will be disabled.`);
}
// --- End Security Check ---


class Logger {
  private static instance: Logger;
  private logger: winston.Logger | undefined; // Logger might not be initialized immediately
  private isInitialized: boolean = false; // Track initialization state

  // Private constructor for singleton pattern
  private constructor() {}

  /**
   * Initializes the Winston logger instance with the specified log level.
   * This method should be called once after the application configuration is loaded.
   * @param {LogLevel} logLevel - The logging level to configure (e.g., "debug", "info"). Defaults to "info".
   */
  public initialize(logLevel: LogLevel = "info"): void {
    if (this.isInitialized) {
      // Use console.warn for pre-initialization warnings
      console.warn("Logger already initialized.");
      return;
    }

    // Ensure logs directory exists only if the path is safe
    if (isLogsDirSafe) {
        try {
            if (!fs.existsSync(resolvedLogsDir)) {
                fs.mkdirSync(resolvedLogsDir, { recursive: true });
                console.log(`Created logs directory: ${resolvedLogsDir}`);
            }
        } catch (error: any) {
            console.error(`Error ensuring logs directory exists at ${resolvedLogsDir}: ${error.message}. File logging might be affected.`);
            isLogsDirSafe = false; // Disable file logging if creation fails
        }
    }

    // Common format for all transports
    const commonFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, context, stack }) => {
        const contextStr = context ? `\n  Context: ${JSON.stringify(context, null, 2)}` : "";
        const stackStr = stack ? `\n  Stack: ${stack}` : "";
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        return `[${timestamp}] ${level}: ${messageStr}${contextStr}${stackStr}`;
      })
    );

    // Define transports
    const transports: winston.transport[] = [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                commonFormat
            ),
            level: logLevel
        })
    ];

    // Add file transports only if the logs directory is safe
    if (isLogsDirSafe) {
        transports.push(
            new winston.transports.File({ filename: path.join(resolvedLogsDir, 'combined.log'), format: commonFormat }),
            new winston.transports.File({ filename: path.join(resolvedLogsDir, 'error.log'), level: 'error', format: commonFormat }),
            new winston.transports.File({ filename: path.join(resolvedLogsDir, 'warn.log'), level: 'warn', format: commonFormat }),
            new winston.transports.File({ filename: path.join(resolvedLogsDir, 'info.log'), level: 'info', format: commonFormat }),
            new winston.transports.File({ filename: path.join(resolvedLogsDir, 'debug.log'), level: 'debug', format: commonFormat })
        );
    } else {
        console.warn("File logging is disabled due to unsafe or inaccessible logs directory.");
    }

    // Create the Winston logger instance
    this.logger = winston.createLogger({
      level: logLevel,
      transports: transports,
      exitOnError: false
    });

    this.isInitialized = true;
    // Use the newly initialized logger itself for the confirmation message
    this.info(`Logger initialized with level: ${logLevel}`);
  }

  /**
   * Returns the singleton instance of the Logger.
   * @returns {Logger} The singleton Logger instance.
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  // Helper to check initialization before logging
  private checkInitialized(methodName: string): boolean {
    if (!this.isInitialized || !this.logger) {
      // Use console.warn for critical logging issues if logger isn't ready
      console.warn(`Logger.${methodName} called before initialization. Message dropped.`);
      return false;
    }
    return true;
  }

  // Logging methods - check initialization before calling Winston logger
  public debug(message: string, context?: Record<string, any>): void {
    if (!this.checkInitialized('debug')) return;
    this.logger?.debug(message, { context });
  }

  public info(message: string, context?: Record<string, any>): void {
    if (!this.checkInitialized('info')) return;
    this.logger?.info(message, { context });
  }

  public warn(message: string, context?: Record<string, any>): void {
    if (!this.checkInitialized('warn')) return;
    this.logger?.warn(message, { context });
  }

  public error(message: string, error?: Error | Record<string, any>, context?: Record<string, any>): void {
      if (!this.checkInitialized('error')) return;
      if (error instanceof Error) {
          this.logger?.error(message, { error: { message: error.message, stack: error.stack }, context });
      } else {
          this.logger?.error(message, { context: { ...error, ...context } });
      }
  }
}

// Export the singleton instance
export const logger = Logger.getInstance();
