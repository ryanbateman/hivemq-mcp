/**
 * @fileoverview Utilities for creating and managing request contexts.
 * A request context is an object carrying a unique ID, timestamp, and other
 * relevant data for logging, tracing, and processing. It also defines
 * configuration and operational context structures.
 * @module utils/internal/requestContext
 */

import { logger } from './logger.js';
// Import utils from the main barrel file (generateUUID from ../security/idGenerator.js)
import { generateUUID } from '../index.js';

/**
 * Defines the core structure for context information associated with a request or operation.
 * This is fundamental for logging, tracing, and passing operational data.
 */
export interface RequestContext {
  /** 
   * Unique ID for the context instance. 
   * Used for log correlation and request tracing.
   */
  requestId: string;

  /** 
   * ISO 8601 timestamp indicating when the context was created.
   */
  timestamp: string;

  /** 
   * Allows arbitrary key-value pairs for specific context needs.
   * Using `unknown` promotes type-safe access.
   * Consumers must type-check/assert when accessing extended properties.
   */
  [key: string]: unknown;
}

/**
 * Configuration for the {@link requestContextService}.
 * Allows for future extensibility of service-wide settings.
 * Currently a placeholder for potential configurations.
 */
export interface ContextConfig {
  /** Custom configuration properties. Allows for arbitrary key-value pairs. */
  [key: string]: unknown;
}

/**
 * Represents a broader context for a specific operation or task,
 * which can optionally include a base {@link RequestContext} and other custom properties.
 */
export interface OperationContext {
  /** Optional base request context data, adhering to the `RequestContext` structure. */
  requestContext?: RequestContext;

  /** Allows for additional, custom properties specific to the operation. */
  [key: string]: unknown;
}

/**
 * Singleton-like service object for managing request context operations.
 * Provides methods to configure the service and create {@link RequestContext} instances.
 */
const requestContextServiceInstance = {
  /**
   * Internal configuration store for the service.
   * Initialized as an empty object and can be updated via the `configure` method.
   */
  config: {} as ContextConfig,

  /**
   * Configures the request context service with new settings.
   * Merges provided partial configuration with existing settings.
   *
   * @param config - A partial `ContextConfig` object containing settings to update or add.
   * @returns A shallow copy of the newly updated configuration.
   */
  configure(config: Partial<ContextConfig>): ContextConfig {
    this.config = {
      ...this.config,
      ...config,
    };
    // Create a new RequestContext for this internal logging event
    const logContext = this.createRequestContext({
        operation: 'RequestContextService.configure',
        // It's good practice to log what was changed or the new state.
        // Be mindful of logging sensitive parts of config if any.
        // Here, we log a snapshot of the new config state.
        newConfigState: { ...this.config } 
    });
    logger.debug('RequestContextService configuration updated', logContext);
    return { ...this.config }; // Return a copy to prevent direct mutation
  },

  /**
   * Retrieves a shallow copy of the current service configuration.
   *
   * @returns A shallow copy of the current `ContextConfig` to prevent direct mutation of internal state.
   */
  getConfig(): ContextConfig {
    return { ...this.config }; // Return a copy
  },

  /**
   * Creates a new {@link RequestContext} instance.
   * Each context is assigned a unique `requestId` generated via UUID and a current `timestamp`.
   * Additional custom properties can be merged into the context.
   *
   * @param additionalContext - An optional record of key-value pairs to be
   *                            included in the created request context. Defaults to an empty object.
   * @returns A new `RequestContext` object.
   */
  createRequestContext(
    additionalContext: Record<string, unknown> = {}
  ): RequestContext {
    const requestId = generateUUID();
    const timestamp = new Date().toISOString();

    const context: RequestContext = {
      requestId,
      timestamp,
      ...additionalContext,
    };
    // logger.debug('Request context created', { requestId }); // Optional: log context creation
    return context;
  },

  // generateSecureRandomString function was previously here but removed as it was unused and redundant.
  // Its functionality, if needed for secure random strings, should be sourced from a dedicated crypto/security module.
};

/**
 * Primary export for request context functionalities.
 * Provides methods to create and manage request contexts.
 */
export const requestContextService = requestContextServiceInstance;
