import fs from "fs";
import path from "path";
import winston from "winston";
import 'winston-daily-rotate-file';
import { BaseErrorCode, McpError } from "../types-global/errors.js";

/**
 * Supported log levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log format types
 */
export type LogFormat = "json" | "simple" | "detailed";

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Log level (debug, info, warn, error) */
  level?: LogLevel;
  /** Directory for log files */
  logDir?: string;
  /** Format for log output */
  format?: LogFormat;
  /** Whether to log to files */
  files?: boolean;
  /** Log rotation settings */
  rotation?: {
    /** Enable log file rotation */
    enabled?: boolean;
    /** Maximum size of each log file before rotation (e.g., "10m", "1g") */
    maxSize?: string;
    /** Maximum number of files to keep */
    maxFiles?: number;
  };
  /** Sensitive data fields that should be redacted from logs */
  sensitiveFields?: string[];
}

/**
 * Absolute logger error that should cause termination
 */
export class LoggerError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(BaseErrorCode.INTERNAL_ERROR, message, details);
    this.name = 'LoggerError';
  }
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: "info",
  logDir: "logs",
  format: "detailed",
  files: true,
  rotation: {
    enabled: true,
    maxSize: "50m",
    maxFiles: 10
  },
  sensitiveFields: [
    'password', 'token', 'secret', 'key', 'apiKey', 'auth', 
    'credential', 'jwt', 'ssn', 'credit', 'card', 'cvv', 'authorization'
  ]
};

/**
 * Generic Logger class with configuration options
 * Implements the Singleton pattern for consistent logging across the application
 */
export class Logger {
  private static instance: Logger;
  private logger: winston.Logger;
  private config: LoggerConfig;
  private initialized: boolean = false;
  
  /**
   * Private constructor (use getInstance instead)
   * @param config Initial logger configuration
   */
  private constructor(config: LoggerConfig = {}) {
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      rotation: {
        ...DEFAULT_CONFIG.rotation,
        ...config.rotation
      },
      sensitiveFields: [
        ...(DEFAULT_CONFIG.sensitiveFields || []),
        ...(config.sensitiveFields || [])
      ]
    };
    
    // Initialize with a minimal logger to avoid TypeScript errors
    this.logger = winston.createLogger({ transports: [] });
    
    this.initializeLogger();
  }

  /**
   * Get or create the singleton logger instance
   * @param config Optional configuration to override defaults
   * @returns The logger instance
   */
  public static getInstance(config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    } else if (config) {
      // Update configuration if provided
      Logger.instance.configure(config);
    }
    return Logger.instance;
  }

  /**
   * Updates logger configuration
   * @param config New configuration options
   */
  public configure(config: LoggerConfig): void {
    // Merge new config with current config
    this.config = {
      ...this.config,
      ...config,
      rotation: {
        ...this.config.rotation,
        ...config.rotation
      },
      sensitiveFields: [
        ...(this.config.sensitiveFields || []),
        ...(config.sensitiveFields || [])
      ]
    };
    
    // Reinitialize the logger with new config
    this.initializeLogger();
  }

  /**
   * Initialize or reinitialize the Winston logger
   */
  private initializeLogger(): void {
    try {
      // Ensure log directory exists
      const logDir = this.config.logDir || DEFAULT_CONFIG.logDir;
      
      if (this.config.files && logDir) {
        // Make sure the log directory exists
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
      }
  
      // Create log format based on configuration
      const logFormat = this.createLogFormat(this.config.format);
      
      // Initialize transports array
      const transports: winston.transport[] = [];
      
      // Add file transports if enabled
      if (this.config.files && logDir) {
        if (this.config.rotation?.enabled) {
          // Use winston-daily-rotate-file for log rotation
          transports.push(new winston.transports.DailyRotateFile({
            filename: path.join(logDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: this.config.rotation.maxSize,
            maxFiles: this.config.rotation.maxFiles,
            format: logFormat
          }));
          
          // Error logs
          transports.push(new winston.transports.DailyRotateFile({
            filename: path.join(logDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: this.config.rotation.maxSize,
            maxFiles: this.config.rotation.maxFiles,
            level: 'error',
            format: logFormat
          }));
        } else {
          // Standard file logging without rotation
          transports.push(new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            format: logFormat
          }));
          
          transports.push(new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            format: logFormat
          }));
        }
      }
  
      // Create the Winston logger with a silent transport as fallback
      // if no other transports are available
      if (transports.length === 0) {
        transports.push(new winston.transports.Stream({
          stream: fs.createWriteStream('/dev/null', { flags: 'a' }),
          silent: true
        }));
      }
      
      this.logger = winston.createLogger({
        level: this.config.level || DEFAULT_CONFIG.level,
        format: winston.format.combine(
          winston.format(this.sanitizeSensitiveData.bind(this))(),
          winston.format.json()
        ),
        defaultMeta: { service: 'mcp-service' },
        transports
      });
      
      this.initialized = true;
    } catch (error) {
      // Create a silent logger as fallback - never use console
      this.logger = winston.createLogger({
        silent: true,
        transports: [
          new winston.transports.Stream({
            stream: fs.createWriteStream('/dev/null', { flags: 'a' }),
            silent: true
          })
        ]
      });
    }
  }

  /**
   * Sanitize sensitive data in logs
   */
  private sanitizeSensitiveData(info: any): any {
    if (!info || typeof info !== 'object') {
      return info;
    }
    
    // Get sensitive fields from config
    const sensitiveFields = this.config.sensitiveFields || DEFAULT_CONFIG.sensitiveFields || [];
    
    // Create deep copy to avoid modifying the original
    const sanitized = { ...info };
    
    // Sanitize context if it exists
    if (sanitized.context && typeof sanitized.context === 'object') {
      sanitized.context = this.redactSensitiveFields(sanitized.context, sensitiveFields);
    }
    
    return sanitized;
  }
  
  /**
   * Recursively redact sensitive fields in an object
   */
  private redactSensitiveFields(obj: any, sensitiveFields: string[]): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveFields(item, sensitiveFields));
    }
    
    // Handle regular objects
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Check if this key matches any sensitive field pattern
      const isSensitive = sensitiveFields.some(field => 
        key.toLowerCase().includes(field.toLowerCase())
      );
      
      if (isSensitive) {
        // Redact sensitive value
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        // Recursively process nested objects
        result[key] = this.redactSensitiveFields(value, sensitiveFields);
      } else {
        // Pass through non-sensitive values
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Create the appropriate log format based on configuration
   * @param format Format type string
   * @returns Winston format
   */
  private createLogFormat(format: LogFormat = "detailed"): winston.Logform.Format {
    switch (format) {
      case "json":
        return winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        );
        
      case "simple":
        return winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level}: ${message}`;
          })
        );
        
      case "detailed":
      default:
        return winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.printf(({ timestamp, level, message, context, stack }) => {
            const contextStr = context ? `\n  Context: ${JSON.stringify(context, null, 2)}` : "";
            const stackStr = stack ? `\n  Stack: ${stack}` : "";
            return `[${timestamp}] ${level}: ${message}${contextStr}${stackStr}`;
          })
        );
    }
  }

  /**
   * Log a debug message
   * @param message The message to log
   * @param context Optional context object
   */
  public debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(message, { context });
  }

  /**
   * Log an info message
   * @param message The message to log
   * @param context Optional context object
   */
  public info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(message, { context });
  }

  /**
   * Log a warning message
   * @param message The message to log
   * @param context Optional context object
   */
  public warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(message, { context });
  }

  /**
   * Log an error message
   * @param message The message to log
   * @param context Optional context object
   */
  public error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(message, { context });
  }

  /**
   * Log an exception with full stack trace
   * @param message The error message
   * @param error The error object
   * @param context Additional context
   */
  public exception(message: string, error: Error, context?: Record<string, unknown>): void {
    this.logger.error(message, {
      context,
      stack: error.stack,
      error: {
        name: error.name,
        message: error.message
      }
    });
  }

  /**
   * Create a child logger with additional default context
   * @param defaultContext Default context to include with all log messages
   * @returns A child logger instance
   */
  public createChildLogger(defaultContext: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, defaultContext);
  }
  
  /**
   * Dispose logger resources
   */
  public dispose(): void {
    this.logger.close();
  }
}

/**
 * Child logger that includes default context with all log messages
 */
export class ChildLogger {
  /**
   * Create a new child logger
   * @param parent Parent logger
   * @param defaultContext Default context to include with all log messages
   */
  constructor(
    private parent: Logger,
    private defaultContext: Record<string, unknown>
  ) {}

  /**
   * Merge provided context with default context
   * @param context Additional context
   * @returns Merged context
   */
  private mergeContext(context?: Record<string, unknown>): Record<string, unknown> {
    return {
      ...this.defaultContext,
      ...context
    };
  }

  /**
   * Log a debug message
   * @param message The message to log
   * @param context Additional context
   */
  public debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  /**
   * Log an info message
   * @param message The message to log
   * @param context Additional context
   */
  public info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.mergeContext(context));
  }

  /**
   * Log a warning message
   * @param message The message to log
   * @param context Additional context
   */
  public warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  /**
   * Log an error message
   * @param message The message to log
   * @param context Additional context
   */
  public error(message: string, context?: Record<string, unknown>): void {
    this.parent.error(message, this.mergeContext(context));
  }

  /**
   * Log an exception with full stack trace
   * @param message The error message
   * @param error The error object
   * @param context Additional context
   */
  public exception(message: string, error: Error, context?: Record<string, unknown>): void {
    this.parent.exception(message, error, this.mergeContext(context));
  }
}

// Create default logger instance
export const logger = Logger.getInstance({
  // Use files only
  files: true,
  // Use a relative path in the project directory
  logDir: "logs"
});

export default logger;