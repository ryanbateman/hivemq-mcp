import { logger } from './logger.js';
import { RequestContext } from './rateLimiter.js'; // Assuming RequestContext is defined here or globally

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

// Direct instance for request context utilities
const requestContextServiceInstance = {
  config: {} as ContextConfig,

  /**
   * Configure service settings
   * @param config New configuration
   * @returns Updated configuration
   */
  configure(config: Partial<ContextConfig>): ContextConfig {
    this.config = {
      ...this.config,
      ...config
    };
    logger.debug('RequestContext configuration updated', { config: this.config });
    return { ...this.config };
  },

  /**
   * Get current configuration
   * @returns Current configuration
   */
  getConfig(): ContextConfig {
    return { ...this.config };
  },

  /**
   * Create a request context with unique ID and timestamp
   * @param additionalContext Additional context properties
   * @returns Request context object
   */
  createRequestContext(
    additionalContext: Record<string, unknown> = {}
  ): RequestContext {
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    return {
      requestId,
      timestamp,
      ...additionalContext
    };
  },

  /**
   * Generate a secure random string
   * @param length Length of the string
   * @param chars Character set to use
   * @returns Random string
   */
  generateSecureRandomString(
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
};

// Initialize logger message
logger.debug('RequestContext service initialized');

// Export the instance directly
export const requestContextService = requestContextServiceInstance;

// Removed delegate functions and default export for simplicity.
// Users should import and use `requestContextService` directly.
// e.g., import { requestContextService } from './requestContext.js';
// requestContextService.createRequestContext();
