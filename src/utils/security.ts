/**
 * @file security.ts
 * @description Compatibility module that re-exports all security utilities
 * from the modularized files. This ensures a clean modern architecture
 * while maintaining a single import point for security-related functionality.
 */

// Re-export everything from requestContext.ts
export * from './requestContext.js';

// Re-export everything from sanitization.ts
export * from './sanitization.js';

// Import the default exports from each module
import requestContext from './requestContext.js';
import sanitization from './sanitization.js';
import { rateLimiter, RateLimiter } from './rateLimiter.js';

// Re-export the combined default object
export default {
  // Request context components
  configureContext: requestContext.configureContext,
  createRequestContext: requestContext.createRequestContext,
  generateSecureRandomString: requestContext.generateSecureRandomString,
  
  // Sanitization components
  sanitizeInput: sanitization.sanitizeInput,
  sanitizeInputForLogging: sanitization.sanitizeInputForLogging,
  
  // Re-export rateLimiter for compatibility
  RateLimiter,
  rateLimiter
};