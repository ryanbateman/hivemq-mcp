import { logger } from './logger.js';
import { RequestContext } from './rateLimiter.js';

/**
 * Configuration interface for request context utilities
 */
export interface ContextConfig {
  /** Custom configuration properties */
  [key: string]: unknown;
}

/**
 * Operation context with request data
 */
export interface OperationContext {
  /** Request context data */
  requestContext?: RequestContext;
  /** Custom context properties */
  [key: string]: unknown;
}

/**
 * Request context utilities class
 */
export class RequestContextService {
  private static instance: RequestContextService;
  private config: ContextConfig = {};

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    logger.debug('RequestContext service initialized');
  }

  /**
   * Get the singleton RequestContextService instance
   * @returns RequestContextService instance
   */
  public static getInstance(): RequestContextService {
    if (!RequestContextService.instance) {
      RequestContextService.instance = new RequestContextService();
    }
    return RequestContextService.instance;
  }

  /**
   * Configure service settings
   * @param config New configuration
   * @returns Updated configuration
   */
  public configure(config: Partial<ContextConfig>): ContextConfig {
    this.config = {
      ...this.config,
      ...config
    };
    
    logger.debug('RequestContext configuration updated');
    
    return { ...this.config };
  }

  /**
   * Get current configuration
   * @returns Current configuration
   */
  public getConfig(): ContextConfig {
    return { ...this.config };
  }

  /**
   * Create a request context with unique ID and timestamp
   * @param additionalContext Additional context properties
   * @returns Request context object
   */
  public createRequestContext(
    additionalContext: Record<string, unknown> = {}
  ): RequestContext {
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    return {
      requestId,
      timestamp,
      ...additionalContext
    };
  }

  /**
   * Generate a secure random string
   * @param length Length of the string
   * @param chars Character set to use
   * @returns Random string
   */
  public generateSecureRandomString(
    length: number = 32,
    chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  ): string {
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    
    return result;
  }
}

// Create and export singleton instance
export const requestContextService = RequestContextService.getInstance();

// Export convenience functions that delegate to the singleton instance
export const configureContext = (config: Partial<ContextConfig>): ContextConfig => {
  return requestContextService.configure(config);
};

export const createRequestContext = (
  additionalContext: Record<string, unknown> = {}
): RequestContext => {
  return requestContextService.createRequestContext(additionalContext);
};

export const generateSecureRandomString = (
  length: number = 32,
  chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
): string => {
  return requestContextService.generateSecureRandomString(length, chars);
};

// Export default utilities
export default {
  requestContextService,
  configureContext,
  createRequestContext,
  generateSecureRandomString
};