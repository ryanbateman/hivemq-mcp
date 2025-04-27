import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import TransportStream from 'winston-transport';
import { config } from '../config/index.js'; // Import config for logger name

/**
 * Supported logging levels based on RFC 5424 Syslog severity levels used by MCP.
 * emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7
 */
export type McpLogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'crit' | 'alert' | 'emerg';

// Define the numeric severity for comparison (lower is more severe)
const mcpLevelSeverity: Record<McpLogLevel, number> = {
  emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7
};

// Map MCP levels to Winston's core levels for file logging
const mcpToWinstonLevel: Record<McpLogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  notice: 'info', // Map notice to info for file logging
  warning: 'warn',
  error: 'error',
  crit: 'error',  // Map critical levels to error for file logging
  alert: 'error',
  emerg: 'error',
};

// Type for the MCP notification sender function
export type McpNotificationSender = (level: McpLogLevel, data: any, loggerName?: string) => void;

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root assumed two levels above utils/
const projectRoot = path.resolve(__dirname, '..', '..');
const logsDir = path.join(projectRoot, 'logs');

// Security: ensure logsDir is within projectRoot
const resolvedLogsDir = path.resolve(logsDir);
const isLogsDirSafe = resolvedLogsDir === projectRoot || resolvedLogsDir.startsWith(projectRoot + path.sep);
if (!isLogsDirSafe) {
  // Use console.error here as logger might not be initialized or safe
  console.error(
    `FATAL: logs directory "${resolvedLogsDir}" is outside project root "${projectRoot}". File logging disabled.`
  );
}

/**
 * Singleton Logger wrapping Winston, adapted for MCP.
 * Logs to files and optionally sends MCP notifications/message.
 */
class Logger {
  private static instance: Logger;
  private winstonLogger?: winston.Logger;
  private initialized = false;
  private mcpNotificationSender?: McpNotificationSender;
  private currentMcpLevel: McpLogLevel = 'info'; // Default MCP level
  private currentWinstonLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'; // Default Winston level

  private constructor() {}

  /**
   * Initialize Winston logger for file transport. Must be called once at app start.
   * Console transport is removed.
   * @param level Initial minimum level to log ('info' default).
   */
  public initialize(level: McpLogLevel = 'info'): void {
    if (this.initialized) {
      // Use console.warn as logger might be re-initializing
      console.warn('Logger already initialized.');
      return;
    }
    this.currentMcpLevel = level;
    this.currentWinstonLevel = mcpToWinstonLevel[level];

    // Ensure logs directory exists
    if (isLogsDirSafe) {
      try {
        if (!fs.existsSync(resolvedLogsDir)) {
          fs.mkdirSync(resolvedLogsDir, { recursive: true });
          // Use console.log as logger isn't fully ready
          console.log(`Created logs directory: ${resolvedLogsDir}`);
        }
      } catch (err: any) {
        // Use console.error as logger isn't fully ready
        console.error(
          `Error creating logs directory at ${resolvedLogsDir}: ${err.message}. File logging disabled.`
        );
      }
    }

    // Common format for files
    const fileFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      // Use JSON format for file logs for easier parsing
      winston.format.json()
    );

    const transports: TransportStream[] = [];

    // Add file transports only if the directory is safe
    if (isLogsDirSafe) {
      transports.push(
        // Log levels equal to or more severe than the specified level
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'error.log'), level: 'error', format: fileFormat }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'warn.log'), level: 'warn', format: fileFormat }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'info.log'), level: 'info', format: fileFormat }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'debug.log'), level: 'debug', format: fileFormat }),
        // Combined log captures everything based on the main logger level
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'combined.log'), format: fileFormat })
      );
    } else {
       // Use console.warn as logger isn't fully ready
       console.warn("File logging disabled due to unsafe logs directory path.");
    }

    // Create logger with the initial Winston level and file transports
    this.winstonLogger = winston.createLogger({
        level: this.currentWinstonLevel, // Set Winston level for file logging
        transports,
        exitOnError: false
    });

    this.initialized = true;
    // Log initialization message using the logger itself (will go to file)
    this.info(`Logger initialized. File logging level: ${this.currentWinstonLevel}. MCP logging level: ${this.currentMcpLevel}`);
  }

  /**
   * Sets the function used to send MCP 'notifications/message'.
   * This should be called by the server logic once an MCP connection
   * supporting logging is established.
   * @param sender The function to call for sending notifications.
   */
  public setMcpNotificationSender(sender: McpNotificationSender | undefined): void {
    this.mcpNotificationSender = sender;
    const status = sender ? 'enabled' : 'disabled';
    this.info(`MCP notification sending ${status}.`);
  }

  /**
   * Dynamically sets the minimum logging level for both file logging and MCP notifications.
   * @param newLevel The new minimum MCP log level.
   */
  public setLevel(newLevel: McpLogLevel): void {
    if (!this.ensureInitialized()) {
      // Use console.error as logger state is uncertain
      console.error("Cannot set level: Logger not initialized.");
      return;
    }

    // Validate the level
    if (!(newLevel in mcpLevelSeverity)) {
       this.warning(`Invalid MCP log level provided: ${newLevel}. Level not changed.`);
       return;
    }

    this.currentMcpLevel = newLevel;
    this.currentWinstonLevel = mcpToWinstonLevel[newLevel];
    this.winstonLogger!.level = this.currentWinstonLevel; // Update Winston level for files

    this.info(`Log level set. File logging level: ${this.currentWinstonLevel}. MCP logging level: ${this.currentMcpLevel}`);
  }


  /** Get singleton instance. */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Ensures the logger has been initialized. */
  private ensureInitialized(): boolean {
    if (!this.initialized || !this.winstonLogger) {
      // Use console.warn as this indicates a programming error (calling log before init)
      console.warn('Logger not initialized; message dropped.');
      return false;
    }
    return true;
  }

  /** Centralized log processing */
  private log(level: McpLogLevel, msg: string, context?: Record<string, any>, error?: Error): void {
    if (!this.ensureInitialized()) return;

    // Check if message level is severe enough for current setting
    if (mcpLevelSeverity[level] > mcpLevelSeverity[this.currentMcpLevel]) {
      return; // Skip logging if level is less severe than current setting
    }

    const logData: Record<string, any> = { ...context }; // Copy context
    const winstonLevel = mcpToWinstonLevel[level];

    // Log to Winston (files)
    if (error) {
      // Include error details for Winston file log
      logData.error = { message: error.message, stack: error.stack };
      this.winstonLogger!.log(winstonLevel, msg, logData);
    } else {
      this.winstonLogger!.log(winstonLevel, msg, logData);
    }


    // Send MCP notification if sender is configured
    if (this.mcpNotificationSender) {
        // Prepare data for MCP: combine message and context/error info
        const mcpDataPayload: any = { message: msg };
        if (context) {
            mcpDataPayload.context = context;
        }
        if (error) {
            // Include simplified error info for MCP notification
            mcpDataPayload.error = { message: error.message };
            // Optionally include stack in debug mode? Be cautious about size.
            if (this.currentMcpLevel === 'debug' && error.stack) {
                 mcpDataPayload.error.stack = error.stack.substring(0, 500); // Limit stack trace size
            }
        }
        try {
             this.mcpNotificationSender(level, mcpDataPayload, config.mcpServerName);
        } catch (sendError) {
            // Log failure to send MCP notification to file log
            this.winstonLogger!.error("Failed to send MCP log notification", {
                originalLevel: level,
                originalMessage: msg,
                sendError: sendError instanceof Error ? sendError.message : String(sendError),
                mcpPayload: mcpDataPayload // Log what we tried to send
            });
        }
    }
  }

  // --- Public Logging Methods ---

  /** Log debug message (level 7) */
  public debug(msg: string, context?: Record<string, any>): void {
    this.log('debug', msg, context);
  }

  /** Log info message (level 6) */
  public info(msg: string, context?: Record<string, any>): void {
    this.log('info', msg, context);
  }

  /** Log notice message (level 5) */
  public notice(msg: string, context?: Record<string, any>): void {
    this.log('notice', msg, context);
  }

  /** Log warning message (level 4) */
  public warning(msg: string, context?: Record<string, any>): void {
    this.log('warning', msg, context);
  }

  /** Log error message (level 3) */
  public error(msg: string, err?: Error | Record<string, any>, context?: Record<string, any>): void {
    if (err instanceof Error) {
      this.log('error', msg, context, err);
    } else {
      // If err is not an Error object, treat it as additional context
      const combinedContext = { ...(err || {}), ...(context || {}) };
      this.log('error', msg, combinedContext);
    }
  }

   /** Log critical message (level 2) */
   public crit(msg: string, err?: Error | Record<string, any>, context?: Record<string, any>): void {
    if (err instanceof Error) {
      this.log('crit', msg, context, err);
    } else {
      const combinedContext = { ...(err || {}), ...(context || {}) };
      this.log('crit', msg, combinedContext);
    }
  }

  /** Log alert message (level 1) */
  public alert(msg: string, err?: Error | Record<string, any>, context?: Record<string, any>): void {
     if (err instanceof Error) {
      this.log('alert', msg, context, err);
    } else {
      const combinedContext = { ...(err || {}), ...(context || {}) };
      this.log('alert', msg, combinedContext);
    }
  }

  /** Log emergency message (level 0) */
  public emerg(msg: string, err?: Error | Record<string, any>, context?: Record<string, any>): void {
     if (err instanceof Error) {
      this.log('emerg', msg, context, err);
    } else {
      const combinedContext = { ...(err || {}), ...(context || {}) };
      this.log('emerg', msg, combinedContext);
    }
  }

  /** Log fatal message (alias for emergency, ensures process exit) */
   public fatal(msg: string, context?: Record<string, any>, error?: Error): void {
    this.log('emerg', msg, context, error);
    // Optionally add logic here to ensure process termination after logging fatal error
    // Be careful with async operations here if you intend immediate exit.
    // process.exit(1); // Consider if this is appropriate for your application's shutdown logic
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Initialize logger on import (can be configured later via setLevel/setMcpNotificationSender)
// Read initial level from env var or default to 'info'
const initialLogLevel = (process.env.MCP_LOG_LEVEL as McpLogLevel) || 'info';
logger.initialize(initialLogLevel);
