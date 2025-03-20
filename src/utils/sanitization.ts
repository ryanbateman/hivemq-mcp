import path from 'path';
import normalize from 'path-normalize';
import sanitizeHtml from 'sanitize-html';
import validator from 'validator';
import * as xssFilters from 'xss-filters';
import { BaseErrorCode, McpError } from '../types-global/errors.js';
import { logger } from './logger.js';

/**
 * Options for path sanitization
 */
export interface PathSanitizeOptions {
  /** Restrict paths to a specific root directory */
  rootDir?: string;
  /** Normalize Windows-style paths to POSIX-style */
  toPosix?: boolean;
  /** Allow absolute paths (if false, converts to relative paths) */
  allowAbsolute?: boolean;
}

/**
 * Context-specific input sanitization options
 */
export interface SanitizeStringOptions {
  /** Handle content differently based on context */
  context?: 'text' | 'html' | 'attribute' | 'url' | 'javascript';
  /** Custom allowed tags when using html context */
  allowedTags?: string[];
  /** Custom allowed attributes when using html context */
  allowedAttributes?: Record<string, string[]>;
}

/**
 * Configuration for HTML sanitization
 */
export interface HtmlSanitizeConfig {
  /** Allowed HTML tags */
  allowedTags?: string[];
  /** Allowed HTML attributes (global or per-tag) */
  allowedAttributes?: sanitizeHtml.IOptions['allowedAttributes'];
  /** Allow preserving comments - uses allowedTags internally */
  preserveComments?: boolean;
  /** Custom URL sanitizer */
  transformTags?: sanitizeHtml.IOptions['transformTags'];
}

/**
 * Sanitization class for handling various input sanitization tasks
 */
export class Sanitization {
  private static instance: Sanitization;
  
  /** Default list of sensitive fields for sanitizing logs */
  private sensitiveFields: string[] = [
    'password', 'token', 'secret', 'key', 'apiKey', 'auth', 
    'credential', 'jwt', 'ssn', 'credit', 'card', 'cvv', 'authorization'
  ];

  /** Default sanitize-html configuration */
  private defaultHtmlSanitizeConfig: HtmlSanitizeConfig = {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 
      'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 
      'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre'
    ],
    allowedAttributes: {
      'a': ['href', 'name', 'target'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      '*': ['class', 'id', 'style']
    },
    preserveComments: false
  };

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    logger.debug('Sanitization service initialized with modern libraries');
  }

  /**
   * Get the singleton Sanitization instance
   * @returns Sanitization instance
   */
  public static getInstance(): Sanitization {
    if (!Sanitization.instance) {
      Sanitization.instance = new Sanitization();
    }
    return Sanitization.instance;
  }

  /**
   * Set sensitive fields for log sanitization
   * @param fields Array of field names to consider sensitive
   */
  public setSensitiveFields(fields: string[]): void {
    this.sensitiveFields = [...this.sensitiveFields, ...fields];
    logger.debug('Updated sensitive fields list', { count: this.sensitiveFields.length });
  }

  /**
   * Get the current list of sensitive fields
   * @returns Array of sensitive field names
   */
  public getSensitiveFields(): string[] {
    return [...this.sensitiveFields];
  }

  /**
   * Sanitize HTML content using sanitize-html library
   * @param input HTML string to sanitize
   * @param config Optional custom sanitization config
   * @returns Sanitized HTML
   */
  public sanitizeHtml(input: string, config?: HtmlSanitizeConfig): string {
    if (!input) return '';
    
    // Create sanitize-html options from our config
    const options: sanitizeHtml.IOptions = {
      allowedTags: config?.allowedTags || this.defaultHtmlSanitizeConfig.allowedTags,
      allowedAttributes: config?.allowedAttributes || this.defaultHtmlSanitizeConfig.allowedAttributes,
      transformTags: config?.transformTags
    };
    
    // Handle comments - if preserveComments is true, add '!--' to allowedTags
    if (config?.preserveComments || this.defaultHtmlSanitizeConfig.preserveComments) {
      options.allowedTags = [...(options.allowedTags || []), '!--'];
    }
    
    return sanitizeHtml(input, options);
  }

  /**
   * Sanitize string input based on context
   * @param input String to sanitize
   * @param options Sanitization options
   * @returns Sanitized string
   */
  public sanitizeString(input: string, options: SanitizeStringOptions = {}): string {
    if (!input) return '';
    
    // Handle based on context
    switch (options.context) {
      case 'html':
        // Use sanitize-html with custom options
        return this.sanitizeHtml(input, {
          allowedTags: options.allowedTags,
          allowedAttributes: options.allowedAttributes ? 
            this.convertAttributesFormat(options.allowedAttributes) : 
            undefined
        });
        
      case 'attribute':
        // Use xss-filters for HTML attributes
        return xssFilters.inHTMLData(input);
          
      case 'url':
        // Validate and sanitize URL
        if (!validator.isURL(input, { 
          protocols: ['http', 'https'],
          require_protocol: true
        })) {
          return '';
        }
        return validator.trim(input);
        
      case 'javascript':
        // Reject any attempt to sanitize JavaScript
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          'JavaScript sanitization not supported through string sanitizer',
          { input: input.substring(0, 50) }
        );
        
      case 'text':
      default:
        // Use XSS filters for basic text
        return xssFilters.inHTMLData(input);
    }
  }

  /**
   * Sanitize URL with robust validation and sanitization
   * @param input URL to sanitize
   * @param allowedProtocols Allowed URL protocols
   * @returns Sanitized URL
   */
  public sanitizeUrl(input: string, allowedProtocols: string[] = ['http', 'https']): string {
    try {
      // First validate the URL format
      if (!validator.isURL(input, { 
        protocols: allowedProtocols,
        require_protocol: true 
      })) {
        throw new Error('Invalid URL format');
      }
      
      // Double-check no javascript: protocol sneaked in
      if (input.toLowerCase().includes('javascript:')) {
        throw new Error('JavaScript protocol not allowed');
      }
      
      // Sanitize and return
      return validator.trim(xssFilters.uriInHTMLData(input));
    } catch (error) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid URL format',
        { input, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Sanitize file paths to prevent path traversal attacks
   * @param input Path to sanitize
   * @param options Options for path sanitization
   * @returns Sanitized and normalized path
   */
  public sanitizePath(input: string, options: PathSanitizeOptions = {}): string {
    try {
      if (!input) {
        throw new Error('Empty path');
      }
      
      // Apply path normalization (resolves '..' and '.' segments properly)
      let normalized = normalize(input);
      
      // Convert backslashes to forward slashes if toPosix is true
      if (options.toPosix) {
        normalized = normalized.replace(/\\/g, '/');
      }
      
      // Handle absolute paths based on allowAbsolute option
      if (!options.allowAbsolute && path.isAbsolute(normalized)) {
        // Remove leading slash or drive letter to make it relative
        normalized = normalized.replace(/^(?:[A-Za-z]:)?[/\\]/, '');
      }
      
      // If rootDir is specified, ensure the path doesn't escape it
      if (options.rootDir) {
        const rootDir = path.resolve(options.rootDir);
        
        // Resolve the normalized path against the root dir
        const fullPath = path.resolve(rootDir, normalized);
        
        // More robust check for path traversal
        if (!fullPath.startsWith(rootDir + path.sep) && fullPath !== rootDir) {
          throw new Error('Path traversal detected');
        }
        
        // Return the path relative to the root
        return path.relative(rootDir, fullPath);
      }
      
      // Final validation - ensure the path doesn't contain suspicious patterns
      if (normalized.includes('\0') || normalized.match(/\\\\[.?]|\.\.\\/)) {
        throw new Error('Invalid path characters detected');
      }
      
      return normalized;
    } catch (error) {
      // Log the error for debugging
      logger.warn('Path sanitization error', { 
        input, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Return a safe default in case of errors
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid or unsafe path',
        { input }
      );
    }
  }
  
  /**
   * Sanitize a JSON string
   * @param input JSON string to sanitize
   * @param maxSize Maximum allowed size in bytes
   * @returns Parsed and sanitized object
   */
  public sanitizeJson<T = unknown>(input: string, maxSize?: number): T {
    try {
      // Check size limit if specified
      if (maxSize !== undefined && input.length > maxSize) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `JSON exceeds maximum allowed size of ${maxSize} bytes`,
          { size: input.length, maxSize }
        );
      }
      
      // Validate JSON format
      if (!validator.isJSON(input)) {
        throw new Error('Invalid JSON format');
      }
      
      return JSON.parse(input) as T;
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid JSON format',
        { input: input.length > 100 ? `${input.substring(0, 100)}...` : input }
      );
    }
  }
  
  /**
   * Ensure input is within a numeric range
   * @param input Number to validate
   * @param min Minimum allowed value
   * @param max Maximum allowed value
   * @returns Sanitized number within range
   */
  public sanitizeNumber(input: number | string, min?: number, max?: number): number {
    let value: number;
    
    // Handle string input
    if (typeof input === 'string') {
      if (!validator.isNumeric(input)) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          'Invalid number format',
          { input }
        );
      }
      value = parseFloat(input);
    } else {
      value = input;
    }
    
    if (isNaN(value)) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Invalid number format',
        { input }
      );
    }
    
    if (min !== undefined && value < min) {
      value = min;
    }
    
    if (max !== undefined && value > max) {
      value = max;
    }
    
    return value;
  }

  /**
   * Sanitize input for logging to protect sensitive information
   * @param input Input to sanitize
   * @returns Sanitized input safe for logging
   */
  public sanitizeForLogging(input: unknown): unknown {
    if (!input || typeof input !== 'object') {
      return input;
    }
    
    // Create a deep copy to avoid modifying the original
    const sanitized = Array.isArray(input) 
      ? [...input] 
      : { ...input as Record<string, unknown> };
      
    // Recursively sanitize the object
    this.redactSensitiveFields(sanitized);
    
    return sanitized;
  }

  /**
   * Private helper to convert attribute format from record to sanitize-html format
   */
  private convertAttributesFormat(attrs: Record<string, string[]>): sanitizeHtml.IOptions['allowedAttributes'] {
    const result: Record<string, string[]> = {};
    for (const [tag, attributes] of Object.entries(attrs)) {
      result[tag] = attributes;
    }
    return result;
  }

  /**
   * Recursively redact sensitive fields in an object
   */
  private redactSensitiveFields(obj: unknown): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      obj.forEach(item => this.redactSensitiveFields(item));
      return;
    }
    
    // Handle regular objects
    for (const [key, value] of Object.entries(obj)) {
      // Check if this key matches any sensitive field pattern
      const isSensitive = this.sensitiveFields.some(field => 
        key.toLowerCase().includes(field.toLowerCase())
      );
      
      if (isSensitive) {
        // Mask sensitive value
        (obj as Record<string, unknown>)[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        // Recursively process nested objects
        this.redactSensitiveFields(value);
      }
    }
  }
}

// Create and export singleton instance
export const sanitization = Sanitization.getInstance();

// Export the input sanitization object with convenience functions
export const sanitizeInput = {
  /**
   * Remove potentially dangerous characters from strings based on context
   * @param input String to sanitize
   * @param options Sanitization options for context-specific handling
   * @returns Sanitized string
   */
  string: (input: string, options: SanitizeStringOptions = {}): string => 
    sanitization.sanitizeString(input, options),

  /**
   * Sanitize HTML to prevent XSS
   * @param input HTML string to sanitize
   * @param config Optional custom sanitization config
   * @returns Sanitized HTML
   */
  html: (input: string, config?: HtmlSanitizeConfig): string => 
    sanitization.sanitizeHtml(input, config),

  /**
   * Sanitize URLs
   * @param input URL to sanitize
   * @param allowedProtocols Allowed URL protocols
   * @returns Sanitized URL
   */
  url: (input: string, allowedProtocols: string[] = ['http', 'https']): string => 
    sanitization.sanitizeUrl(input, allowedProtocols),

  /**
   * Sanitize file paths to prevent path traversal attacks
   * @param input Path to sanitize
   * @param options Options for path sanitization
   * @returns Sanitized and normalized path
   */
  path: (input: string, options: PathSanitizeOptions = {}): string => 
    sanitization.sanitizePath(input, options),
    
  /**
   * Sanitize a JSON string
   * @param input JSON string to sanitize
   * @param maxSize Maximum allowed size in bytes
   * @returns Parsed and sanitized object
   */
  json: <T = unknown>(input: string, maxSize?: number): T => 
    sanitization.sanitizeJson<T>(input, maxSize),
    
  /**
   * Ensure input is within a numeric range
   * @param input Number to validate
   * @param min Minimum allowed value
   * @param max Maximum allowed value
   * @returns Sanitized number within range
   */
  number: (input: number | string, min?: number, max?: number): number => 
    sanitization.sanitizeNumber(input, min, max)
};

/**
 * Sanitize input for logging to protect sensitive information
 * @param input Input to sanitize
 * @returns Sanitized input safe for logging
 */
export const sanitizeInputForLogging = (input: unknown): unknown => 
  sanitization.sanitizeForLogging(input);

// Export default
export default {
  sanitization,
  sanitizeInput,
  sanitizeInputForLogging
};