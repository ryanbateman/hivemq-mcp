import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import TransportStream from 'winston-transport';
import { config } from '../../config/index.js';
import { RequestContext } from './requestContext.js'; // Added import

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

// Interface for a more structured error object
interface ErrorWithMessageAndStack {
  message?: string;
  stack?: string;
  [key: string]: any; // Allow other properties
}

// Interface for the MCP notification payload
interface McpLogPayload {
  message: string;
  context?: RequestContext;
  error?: {
    message: string;
    stack?: string;
  };
  [key: string]: any; // Allow other properties, like loggerSetup
}

// Type for the MCP notification sender function data parameter
export type McpNotificationData = McpLogPayload | Record<string, unknown>; // McpLogPayload now uses RequestContext

// Type for the MCP notification sender function
export type McpNotificationSender = (level: McpLogLevel, data: McpNotificationData, loggerName?: string) => void;

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Calculate project root robustly (works from src/ or dist/)
const isRunningFromDist = __dirname.includes(path.sep + 'dist' + path.sep);
const levelsToGoUp = isRunningFromDist ? 3 : 2;
const pathSegments = Array(levelsToGoUp).fill('..');
const projectRoot = path.resolve(__dirname, ...pathSegments);

const logsDir = path.join(projectRoot, 'logs');

// Security: ensure logsDir is within projectRoot
const resolvedLogsDir = path.resolve(logsDir);
const isLogsDirSafe = resolvedLogsDir === projectRoot || resolvedLogsDir.startsWith(projectRoot + path.sep);
if (!isLogsDirSafe) {
  // Use console.error for critical pre-init errors.
  // Only log to console if TTY to avoid polluting stdout for stdio MCP clients.
  if (process.stdout.isTTY) {
    console.error(
      `FATAL: logs directory "${resolvedLogsDir}" is outside project root "${projectRoot}". File logging disabled.`
    );
  }
}

/**
 * Helper function to create the Winston console format.
 * This is extracted to avoid duplication between initialize and setLevel.
 */
function createWinstonConsoleFormat() {
  return winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let metaString = '';
      const metaCopy = { ...meta };
      if (metaCopy.error && typeof metaCopy.error === 'object') {
        const errorObj = metaCopy.error as ErrorWithMessageAndStack;
        if (errorObj.message) metaString += `\n  Error: ${errorObj.message}`;
        if (errorObj.stack) metaString += `\n  Stack: ${String(errorObj.stack).split('\n').map((l: string) => `    ${l}`).join('\n')}`;
        delete metaCopy.error; // Remove the error from meta as it's now part of metaString
      }
      // Check if there are any other properties in metaCopy left to stringify
      if (Object.keys(metaCopy).length > 0) {
         try {
            // Only add Meta section if there's something to show after removing 'error'
            const remainingMetaJson = JSON.stringify(metaCopy, null, 2);
            if (remainingMetaJson !== '{}') metaString += `\n  Meta: ${remainingMetaJson}`;
         } catch (stringifyError: unknown) {
            const errorMessage = stringifyError instanceof Error ? stringifyError.message : String(stringifyError);
            metaString += `\n  Meta: [Error stringifying metadata: ${errorMessage}]`;
         }
      }
      return `${timestamp} ${level}: ${message}${metaString}`;
    })
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

  private readonly LOG_FILE_MAX_SIZE = 5 * 1024 * 1024; // 5MB
  private readonly LOG_MAX_FILES = 5; // Keep 5 rotated log files

  private constructor() {}

  /**
   * Initialize Winston logger for file transport. Must be called once at app start.
   * Console transport is added conditionally.
   * @param level Initial minimum level to log ('info' default).
   */
  public async initialize(level: McpLogLevel = 'info'): Promise<void> {
    if (this.initialized) {
      this.warning('Logger already initialized.', { loggerSetup: true, requestId: 'logger-init', timestamp: new Date().toISOString() });
      return;
    }
    this.currentMcpLevel = level;
    this.currentWinstonLevel = mcpToWinstonLevel[level];

    let logsDirCreatedMessage: string | null = null;

    // Ensure logs directory exists
    if (isLogsDirSafe) {
      try {
        if (!fs.existsSync(resolvedLogsDir)) {
          await fs.promises.mkdir(resolvedLogsDir, { recursive: true });
          logsDirCreatedMessage = `Created logs directory: ${resolvedLogsDir}`;
        }
      } catch (err: unknown) {
        // Conditional console output for pre-init errors to avoid issues with stdio MCP clients.
        if (process.stdout.isTTY) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(
            `Error creating logs directory at ${resolvedLogsDir}: ${errorMessage}. File logging disabled.`
          );
        }
      }
    }

    // Common format for files
    const fileFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    const transports: TransportStream[] = [];
    const fileTransportOptions = {
        format: fileFormat,
        maxsize: this.LOG_FILE_MAX_SIZE,
        maxFiles: this.LOG_MAX_FILES,
        tailable: true, // Ensures new logs go to the base filename, and rotated files get numbers
    };

    // Add file transports only if the directory is safe
    if (isLogsDirSafe) {
      transports.push(
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'error.log'), level: 'error', ...fileTransportOptions }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'warn.log'), level: 'warn', ...fileTransportOptions }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'info.log'), level: 'info', ...fileTransportOptions }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'debug.log'), level: 'debug', ...fileTransportOptions }),
        new winston.transports.File({ filename: path.join(resolvedLogsDir, 'combined.log'), ...fileTransportOptions })
      );
    } else {
       // Conditional console output for pre-init warnings.
       if (process.stdout.isTTY) {
         console.warn("File logging disabled due to unsafe logs directory path.");
       }
    }

    let consoleLoggingEnabledMessage: string | null = null;
    let consoleLoggingSkippedMessage: string | null = null;

    // Conditionally add Console transport only if:
    // 1. MCP level is 'debug'
    // 2. stdout is a TTY (interactive terminal, not piped)
    if (this.currentMcpLevel === 'debug' && process.stdout.isTTY) {
      const consoleFormat = createWinstonConsoleFormat();
      transports.push(new winston.transports.Console({
        level: 'debug', // Console transport should also respect its own level setting
        format: consoleFormat,
      }));
      consoleLoggingEnabledMessage = 'Console logging enabled at level: debug (stdout is TTY)';
    } else if (this.currentMcpLevel === 'debug' && !process.stdout.isTTY) {
        consoleLoggingSkippedMessage = 'Console logging skipped: Level is debug, but stdout is not a TTY (likely stdio transport).';
    }

    // Create logger with the initial Winston level and configured transports
    this.winstonLogger = winston.createLogger({
        level: this.currentWinstonLevel, // This is the master level for the logger instance
        transports,
        exitOnError: false // Good practice
    });
    
    const initialContext: RequestContext = { loggerSetup: true, requestId: 'logger-init-deferred', timestamp: new Date().toISOString() };
    // Log deferred messages now that winstonLogger is initialized
    if (logsDirCreatedMessage) {
      this.info(logsDirCreatedMessage, initialContext);
    }
    if (consoleLoggingEnabledMessage) {
      this.info(consoleLoggingEnabledMessage, initialContext);
    }
    if (consoleLoggingSkippedMessage) {
      this.info(consoleLoggingSkippedMessage, initialContext);
    }

    this.initialized = true;
    this.info(`Logger initialized. File logging level: ${this.currentWinstonLevel}. MCP logging level: ${this.currentMcpLevel}. Console logging: ${process.stdout.isTTY && this.currentMcpLevel === 'debug' ? 'enabled' : 'disabled'}`, { loggerSetup: true, requestId: 'logger-post-init', timestamp: new Date().toISOString() });
  }

  /**
   * Sets the function used to send MCP 'notifications/message'.
   */
  public setMcpNotificationSender(sender: McpNotificationSender | undefined): void {
    this.mcpNotificationSender = sender;
    const status = sender ? 'enabled' : 'disabled';
    this.info(`MCP notification sending ${status}.`, { loggerSetup: true, requestId: 'logger-set-sender', timestamp: new Date().toISOString() });
  }

  /**
   * Dynamically sets the minimum logging level.
   */
  public setLevel(newLevel: McpLogLevel): void {
    const setLevelContext: RequestContext = { loggerSetup: true, requestId: 'logger-set-level', timestamp: new Date().toISOString() };
    if (!this.ensureInitialized()) {
      // Conditional console output if logger not usable.
      if (process.stdout.isTTY) {
        console.error("Cannot set level: Logger not initialized.");
      }
      return;
    }
    if (!(newLevel in mcpLevelSeverity)) {
       this.warning(`Invalid MCP log level provided: ${newLevel}. Level not changed.`, setLevelContext);
       return;
    }

    const oldLevel = this.currentMcpLevel;
    this.currentMcpLevel = newLevel;
    this.currentWinstonLevel = mcpToWinstonLevel[newLevel];
    this.winstonLogger!.level = this.currentWinstonLevel;

    // Add or remove console transport based on the new level and TTY status
    const consoleTransport = this.winstonLogger!.transports.find(t => t instanceof winston.transports.Console);
    const shouldHaveConsole = newLevel === 'debug' && process.stdout.isTTY;

    if (shouldHaveConsole && !consoleTransport) {
        // Add console transport
        const consoleFormat = createWinstonConsoleFormat();
        this.winstonLogger!.add(new winston.transports.Console({ level: 'debug', format: consoleFormat }));
        this.info('Console logging dynamically enabled.', setLevelContext);
    } else if (!shouldHaveConsole && consoleTransport) {
        // Remove console transport
        this.winstonLogger!.remove(consoleTransport);
        this.info('Console logging dynamically disabled.', setLevelContext);
    }

    if (oldLevel !== newLevel) {
        this.info(`Log level changed. File logging level: ${this.currentWinstonLevel}. MCP logging level: ${this.currentMcpLevel}. Console logging: ${shouldHaveConsole ? 'enabled' : 'disabled'}`, setLevelContext);
    }
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
      // Conditional console output if logger not usable.
      if (process.stdout.isTTY) {
        console.warn('Logger not initialized; message dropped.');
      }
      return false;
    }
    return true;
  }

  /** Centralized log processing */
  private log(level: McpLogLevel, msg: string, context?: RequestContext, error?: Error): void { // context is now RequestContext
    if (!this.ensureInitialized()) return;
    // Message severity is higher (numerically lower) than current log level, so skip.
    if (mcpLevelSeverity[level] > mcpLevelSeverity[this.currentMcpLevel]) {
      return;
    }

    const logData: Record<string, unknown> = { ...context }; // Spread context into logData
    const winstonLevel = mcpToWinstonLevel[level];

    if (error) {
      // Pass the error object directly to Winston so it can handle stack traces etc.
      this.winstonLogger!.log(winstonLevel, msg, { ...logData, error });
    } else {
      this.winstonLogger!.log(winstonLevel, msg, logData);
    }

    if (this.mcpNotificationSender) {
        const mcpDataPayload: McpLogPayload = { message: msg };
        if (context && Object.keys(context).length > 0) mcpDataPayload.context = context; // Assign context directly
        if (error) {
            mcpDataPayload.error = { message: error.message };
            // Only include stack in debug mode for MCP notifications to avoid overly verbose logs
            if (this.currentMcpLevel === 'debug' && error.stack) {
                 mcpDataPayload.error.stack = error.stack.substring(0, 500); // Truncate stack
            }
        }
        try {
             // Safely access mcpServerName and provide a default if not configured
             const serverName = config?.mcpServerName ?? 'MCP_SERVER_NAME_NOT_CONFIGURED';
             this.mcpNotificationSender(level, mcpDataPayload, serverName);
        } catch (sendError: unknown) {
            const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
            // Use a basic context for this internal logger error to avoid recursion if context itself is problematic
            const internalErrorContext: RequestContext = {
              requestId: context?.requestId || 'logger-internal-error',
              timestamp: new Date().toISOString(),
              originalLevel: level,
              originalMessage: msg,
              sendError: errorMessage,
              mcpPayload: JSON.stringify(mcpDataPayload).substring(0, 500) // Log a truncated string representation
            };
            this.winstonLogger!.error("Failed to send MCP log notification", internalErrorContext);
        }
    }
  }

  // --- Public Logging Methods ---
  public debug(msg: string, context?: RequestContext): void { this.log('debug', msg, context); }
  public info(msg: string, context?: RequestContext): void { this.log('info', msg, context); }
  public notice(msg: string, context?: RequestContext): void { this.log('notice', msg, context); }
  public warning(msg: string, context?: RequestContext): void { this.log('warning', msg, context); }
  
  public error(msg: string, err?: Error | RequestContext, context?: RequestContext): void {
    const errorObj = err instanceof Error ? err : undefined;
    const actualContext = err instanceof Error ? context : err; // If err is not Error, it's the context
    this.log('error', msg, actualContext, errorObj);
  }
   public crit(msg: string, err?: Error | RequestContext, context?: RequestContext): void {
    const errorObj = err instanceof Error ? err : undefined;
    const actualContext = err instanceof Error ? context : err;
    this.log('crit', msg, actualContext, errorObj);
  }
  public alert(msg: string, err?: Error | RequestContext, context?: RequestContext): void {
    const errorObj = err instanceof Error ? err : undefined;
    const actualContext = err instanceof Error ? context : err;
    this.log('alert', msg, actualContext, errorObj);
  }
  public emerg(msg: string, err?: Error | RequestContext, context?: RequestContext): void {
    const errorObj = err instanceof Error ? err : undefined;
    const actualContext = err instanceof Error ? context : err;
    this.log('emerg', msg, actualContext, errorObj);
  }
  public fatal(msg: string, err?: Error | RequestContext, context?: RequestContext): void {
    const errorObj = err instanceof Error ? err : undefined;
    const actualContext = err instanceof Error ? context : err;
    this.log('emerg', msg, actualContext, errorObj); // fatal logs at 'emerg' level
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
