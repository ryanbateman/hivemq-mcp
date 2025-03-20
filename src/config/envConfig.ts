import { BaseErrorCode, McpError } from '../types-global/errors.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sanitizeInput } from '../utils/security.js';

// Create a module-level logger for environment configuration
const envLogger = logger.createChildLogger({
  module: 'EnvConfig'
});

/**
 * Parse a numeric environment variable with validation
 * 
 * @param name - The name of the environment variable
 * @param defaultValue - The default value if not set or invalid
 * @param min - Optional minimum valid value
 * @param max - Optional maximum valid value
 * @returns The parsed numeric value
 */
function parseNumericEnv(
  name: string, 
  defaultValue: number, 
  min?: number, 
  max?: number
): number {
  const rawValue = process.env[name];
  
  if (rawValue === undefined) {
    envLogger.debug(`Using default value for ${name}`, { defaultValue });
    return defaultValue;
  }
  
  try {
    // Sanitize and parse the value
    const sanitizedValue = sanitizeInput.string(rawValue);
    const parsedValue = parseFloat(sanitizedValue);
    
    if (isNaN(parsedValue)) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid numeric value for ${name}: ${sanitizedValue}`,
        { raw: sanitizedValue }
      );
    }
    
    // Apply bounds constraints if provided
    if (min !== undefined && parsedValue < min) {
      envLogger.warn(`Value for ${name} is below minimum (${min}), using minimum`, { 
        parsed: parsedValue, min, raw: sanitizedValue 
      });
      return min;
    }
    
    if (max !== undefined && parsedValue > max) {
      envLogger.warn(`Value for ${name} is above maximum (${max}), using maximum`, { 
        parsed: parsedValue, max, raw: sanitizedValue 
      });
      return max;
    }
    
    envLogger.debug(`Parsed ${name} environment variable`, { value: parsedValue });
    return parsedValue;
  } catch (error) {
    ErrorHandler.handleError(error, {
      context: { envVar: name, rawValue },
      operation: `parsing environment variable ${name}`,
      errorCode: BaseErrorCode.VALIDATION_ERROR
    });
    
    envLogger.warn(`Using default value for ${name} due to parsing error`, { defaultValue });
    return defaultValue;
  }
}

/**
 * Parse a boolean environment variable with validation
 * 
 * @param name - The name of the environment variable
 * @param defaultValue - The default value if not set or invalid
 * @returns The parsed boolean value
 */
function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name];
  
  if (rawValue === undefined) {
    envLogger.debug(`Using default value for ${name}`, { defaultValue });
    return defaultValue;
  }
  
  try {
    // Sanitize the input
    const sanitizedValue = sanitizeInput.string(rawValue).toLowerCase();
    
    // Allow for various truthy/falsy string representations
    if (['true', 'yes', '1', 'on'].includes(sanitizedValue)) {
      return true;
    }
    
    if (['false', 'no', '0', 'off'].includes(sanitizedValue)) {
      return false;
    }
    
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      `Invalid boolean value for ${name}: ${sanitizedValue}`,
      { raw: sanitizedValue }
    );
  } catch (error) {
    ErrorHandler.handleError(error, {
      context: { envVar: name, rawValue },
      operation: `parsing environment variable ${name}`,
      errorCode: BaseErrorCode.VALIDATION_ERROR
    });
    
    envLogger.warn(`Using default value for ${name} due to parsing error`, { defaultValue });
    return defaultValue;
  }
}

/**
 * Handles loading and parsing of environment variables for the application
 * with validation and default values.
 */
function loadEnvConfig() {
  // Log the environment we're loading
  envLogger.info(`Loading environment configuration`, {
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  });

  const config = {
    // Server configuration
    logLevel: process.env.LOG_LEVEL || "info",
    environment: process.env.NODE_ENV || "development",
    
    // Security settings (removed auth-related configuration)
    security: {
      // Can be extended with non-auth security settings in the future
    },
    
    // Rate limiting
    rateLimit: {
      windowMs: parseNumericEnv('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000), // 1 minute default, 1s min, 1h max
      maxRequests: parseNumericEnv('RATE_LIMIT_MAX_REQUESTS', 100, 1, 10000) // 100 requests per minute default, 1-10000 range
    }
  };

  // Log the loaded configuration
  envLogger.info(`Environment configuration loaded`, {
    environment: config.environment,
    logLevel: config.logLevel,
    rateLimitWindowMs: config.rateLimit.windowMs,
    rateLimitMaxRequests: config.rateLimit.maxRequests
  });

  return config;
}

// Cache the configuration once loaded
let cachedEnvConfig: ReturnType<typeof loadEnvConfig> | null = null;

/**
 * Get the environment configuration, loading it on first call
 * 
 * This ensures that we only load the configuration when it's actually needed,
 * not just when the module is imported.
 * 
 * @returns The environment configuration
 */
export const envConfig = () => {
  if (!cachedEnvConfig) {
    cachedEnvConfig = loadEnvConfig();
  }
  return cachedEnvConfig;
};

// For direct property access with destructuring
export const getEnvironment = () => envConfig().environment;
export const getLogLevel = () => envConfig().logLevel;
export const getRateLimit = () => envConfig().rateLimit;
export const getSecurity = () => envConfig().security;