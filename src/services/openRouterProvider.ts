import OpenAI from 'openai';
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming'; // Import Stream type
import { config } from '../config/index.js';
import { BaseErrorCode, McpError } from '../types-global/errors.js';
import { ErrorHandler } from '../utils/internal/errorHandler.js';
import { logger } from '../utils/internal/logger.js';
import { OperationContext, RequestContext } from '../utils/internal/requestContext.js';
import { sanitization } from '../utils/security/sanitization.js';
import { rateLimiter } from '../utils/security/rateLimiter.js';

// Use the updated config properties
const YOUR_SITE_URL = config.openrouterAppUrl;
const YOUR_SITE_NAME = config.openrouterAppName;

// Define a type that includes potential extra params for clarity, outside the method
// Allow stream parameter
type OpenRouterChatParams = (ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) & {
  top_k?: number;
  min_p?: number;
  transforms?: string[];
  models?: string[];
  route?: 'fallback';
  provider?: Record<string, any>; // Define more strictly if needed
  // Add other potential non-standard params here
};


/**
 * Service class for interacting with the OpenRouter API using the OpenAI SDK compatibility.
 */
class OpenRouterProvider {
  private client?: OpenAI; // Client can be undefined if not configured/initialized
  public readonly status: 'unconfigured' | 'initializing' | 'ready' | 'error';
  private initializationError: Error | null = null;

  constructor(apiKey: string | undefined, context?: OperationContext) {
    const opContext = context || { operation: 'OpenRouterProvider.constructor' };
    this.status = 'initializing'; // Start in initializing state

    if (!apiKey) {
      this.status = 'unconfigured';
      logger.warning('OPENROUTER_API_KEY is not set. OpenRouter service is not configured.', { ...opContext, service: 'OpenRouterProvider' });
      return; // Stop initialization
    }

    try {
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey,
        defaultHeaders: {
          'HTTP-Referer': YOUR_SITE_URL, // Use config value
          'X-Title': YOUR_SITE_NAME,      // Use config value
        },
      });
      this.status = 'ready';
      logger.info('OpenRouter Service Initialized and Ready', { ...opContext, service: 'OpenRouterProvider' });
    } catch (error: any) {
      this.status = 'error';
      this.initializationError = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize OpenRouter client', { ...opContext, service: 'OpenRouterProvider', error: this.initializationError.message });
      // Don't throw here, let status indicate failure
    }
  }

  private checkReady(operation: string, context: RequestContext): void {
    if (this.status !== 'ready') {
      let errorCode = BaseErrorCode.SERVICE_UNAVAILABLE;
      let message = `OpenRouter service is not available (status: ${this.status}).`;
      if (this.status === 'unconfigured') {
        errorCode = BaseErrorCode.CONFIGURATION_ERROR;
        message = 'OpenRouter service is not configured (missing API key).';
      } else if (this.status === 'error') {
        errorCode = BaseErrorCode.INITIALIZATION_FAILED;
        message = `OpenRouter service failed to initialize: ${this.initializationError?.message || 'Unknown error'}`;
      }
      logger.error(`[${operation}] Attempted to use OpenRouter service when not ready.`, { ...context, status: this.status });
      throw new McpError(errorCode, message, { operation, status: this.status, cause: this.initializationError });
    }
     if (!this.client) {
        // This should theoretically not happen if status is 'ready', but belts and suspenders
        logger.error(`[${operation}] Service status is ready, but client is missing.`, { ...context });
        throw new McpError(BaseErrorCode.INTERNAL_ERROR, 'Internal inconsistency: OpenRouter client is missing despite ready status.', { operation });
    }
  }


  /**
   * Creates a chat completion using the OpenRouter API. Can return a stream or a single response.
   * @param params - The parameters for the chat completion request, potentially including OpenRouter-specific fields and stream option.
   * @param context - The request context for logging and error handling.
   * @returns A promise that resolves with the chat completion response or an async iterable stream.
   * @throws {McpError} If the service is not ready, the API call fails, or returns an error.
   */
  async chatCompletion(
    params: OpenRouterChatParams, // Use the defined type here
    context: RequestContext
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> { // Updated return type
    const operation = 'OpenRouterProvider.chatCompletion';
    this.checkReady(operation, context); // Check if service is ready

    // Determine if streaming is requested
    const isStreaming = params.stream === true;

    // Explicitly pick known standard OpenAI params and apply defaults
    // Use the appropriate type based on streaming
    const standardParams: Partial<ChatCompletionCreateParamsStreaming | ChatCompletionCreateParamsNonStreaming> = {
      model: params.model || config.llmDefaultModel,
      messages: params.messages,
      // Only include standard params if they exist in the input or have a default from config
      ...(params.temperature !== undefined || config.llmDefaultTemperature !== undefined ? { temperature: params.temperature ?? config.llmDefaultTemperature } : {}),
      ...(params.top_p !== undefined || config.llmDefaultTopP !== undefined ? { top_p: params.top_p ?? config.llmDefaultTopP } : {}),
      // Only include penalties if explicitly provided in params, ignore config defaults for these
      ...(params.presence_penalty !== undefined ? { presence_penalty: params.presence_penalty } : {}),
      ...(params.max_tokens !== undefined || config.llmDefaultMaxTokens !== undefined ? { max_tokens: params.max_tokens ?? config.llmDefaultMaxTokens } : {}),
      ...(params.stream !== undefined && { stream: params.stream }), // Keep stream param if provided
      ...(params.tools !== undefined && { tools: params.tools }),
      ...(params.tool_choice !== undefined && { tool_choice: params.tool_choice }),
      ...(params.response_format !== undefined && { response_format: params.response_format }),
      ...(params.stop !== undefined && { stop: params.stop }),
      ...(params.seed !== undefined && { seed: params.seed }),
      // Only include penalties if explicitly provided in params, ignore config defaults for these
      ...(params.frequency_penalty !== undefined ? { frequency_penalty: params.frequency_penalty } : {}),
      ...(params.logit_bias !== undefined && { logit_bias: params.logit_bias }),
      // Add other standard OpenAI params here if needed, checking params object first
    };

    // Collect remaining/non-standard params for extra_body
    const extraBody: Record<string, any> = {};
    const standardKeys = new Set(Object.keys(standardParams)); // Use Set for faster lookups
    standardKeys.add('messages'); // Ensure messages isn't added to extraBody

    for (const key in params) {
      // Ensure the key is actually a property of params before checking standardKeys
      if (Object.prototype.hasOwnProperty.call(params, key) && !standardKeys.has(key)) {
        extraBody[key] = (params as any)[key];
      }
    }


    // Apply defaults for known non-standard params if they weren't provided in input `params`
    // Check if the key exists in extraBody before applying default from config
    if (extraBody.top_k === undefined && config.llmDefaultTopK !== undefined) {
      extraBody.top_k = config.llmDefaultTopK;
    }
    if (extraBody.min_p === undefined && config.llmDefaultMinP !== undefined) {
      extraBody.min_p = config.llmDefaultMinP;
    }
    // Note: If params explicitly included top_k: null or min_p: null, the loop above would have added them.
    // This logic correctly applies defaults only if the key is entirely absent.

    // Combine for logging
    const allEffectiveParams = { ...standardParams, ...extraBody };
    const sanitizedParams = sanitization.sanitizeForLogging(allEffectiveParams);
    logger.info(`[${operation}] Request received`, { ...context, params: sanitizedParams, streaming: isStreaming });

    // --- BEGIN SPEED PRIORITIZATION ---
    // Ensure provider routing prioritizes throughput for faster responses.
    // If a provider preference is already set, merge 'sort' if not present.
    // If no provider preference exists, create it.
    if (extraBody.provider && typeof extraBody.provider === 'object') {
      if (!extraBody.provider.sort) {
        extraBody.provider.sort = 'throughput';
        logger.debug(`[${operation}] Merged 'sort: throughput' into existing provider preferences.`, context);
      } else {
         logger.debug(`[${operation}] Provider 'sort' preference already exists, respecting provided value: ${extraBody.provider.sort}`, context);
      }
    } else if (extraBody.provider === undefined) {
      // Only add if 'provider' is completely undefined, not if it's null or another type
      extraBody.provider = { sort: 'throughput' };
      logger.debug(`[${operation}] Added 'provider: { sort: 'throughput' }' preferences.`, context);
    }
    // --- END SPEED PRIORITIZATION ---


    // Apply rate limiting before making the API call
    const rateLimitKey = context.requestId || 'openrouter_default_key';
    try {
      rateLimiter.check(rateLimitKey, context);
      logger.debug(`[${operation}] Rate limit check passed`, { ...context, key: rateLimitKey });
    } catch (error) {
      // If rate limit check fails, log and re-throw the McpError (RATE_LIMITED)
      logger.warning(`[${operation}] Rate limit exceeded`, { ...context, key: rateLimitKey, error: error instanceof Error ? error.message : String(error) });
      throw error; // Re-throw the McpError from rateLimiter.check()
    }

    // Use tryCatch for error handling, but return type depends on streaming
    return await ErrorHandler.tryCatch(
      async () => {
        // Ensure client is defined (checkReady should guarantee this, but TS needs reassurance)
        if (!this.client) throw new Error("Client missing despite ready status");

        // Prepare the final parameters for the API call
        // Cast to the correct type based on streaming flag
        const apiParams: any = { ...standardParams };
         if (Object.keys(extraBody).length > 0) {
            // Pass non-standard params via extra_body
            apiParams.extra_body = extraBody;
          }

        try {
          if (isStreaming) {
            // Call with streaming true
            const stream = await this.client.chat.completions.create(
              apiParams as ChatCompletionCreateParamsStreaming // Cast to streaming type
            );
            logger.info(`[${operation}] Streaming request successful`, { ...context, model: apiParams.model });
            return stream;
          } else {
            // Call with streaming false (or default)
            const completion = await this.client.chat.completions.create(
              apiParams as ChatCompletionCreateParamsNonStreaming // Cast to non-streaming type
            );
            logger.info(`[${operation}] Non-streaming request successful`, { ...context, model: apiParams.model });
            // Consider sanitizing completion if logging full response
            // logger.debug(`[${operation}] Response data`, { ...context, response: completion });
            return completion;
          }
        } catch (error: any) {
          // Catch specific OpenAI/API errors if possible, otherwise treat as generic error
          logger.error(`[${operation}] API call failed`, { ...context, error: error.message, status: error.status });
          // Map API errors to McpError types using correct codes and constructor signature (code, message, details?)
          const errorDetails = { providerStatus: error.status, providerMessage: error.message, cause: error?.cause };
          if (error.status === 401) {
            throw new McpError(BaseErrorCode.UNAUTHORIZED, `OpenRouter authentication failed`, errorDetails);
          } else if (error.status === 429) {
            throw new McpError(BaseErrorCode.RATE_LIMITED, `OpenRouter rate limit exceeded`, errorDetails);
          } else if (error.status === 402) {
            // Using FORBIDDEN as the closest match for payment required
            throw new McpError(BaseErrorCode.FORBIDDEN, `OpenRouter insufficient credits or payment required`, errorDetails);
          }
          // Throw a generic internal error for other API statuses
          throw new McpError(BaseErrorCode.INTERNAL_ERROR, `OpenRouter API error (${error.status})`, errorDetails);
        }
      },
      {
        operation,
        context,
        input: sanitizedParams, // Log sanitized input
        errorCode: BaseErrorCode.INTERNAL_ERROR, // Default error code if unexpected error occurs
      }
    );
  }

  // Removed getNextAction and its private helper methods:
  // - buildSystemPrompt
  // - formatToolsForPrompt
  // - formatConversationHistory
  // - parseAndValidateAction

  /**
   * Lists available models from OpenRouter.
   * Note: The standard OpenAI SDK doesn't have a direct equivalent for listing models
   * from a custom base URL like OpenRouter's `/models` endpoint.
   * This method uses fetch directly.
   * @param context - The request context for logging.
   * @returns A promise that resolves with the list of models.
   * @throws {McpError} If the service is not ready or the API call fails.
   */
  async listModels(context: RequestContext): Promise<any> {
    const operation = 'OpenRouterProvider.listModels';
    this.checkReady(operation, context); // Check if service is ready
    logger.info(`[${operation}] Request received`, context);

    return await ErrorHandler.tryCatch(
      async () => {
        // No need to check this.client here, checkReady handles it
        try {
          const response = await fetch('https://openrouter.ai/api/v1/models', {
            method: 'GET',
            headers: {
              // No API key needed for listing models as per OpenRouter docs
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorBody = await response.text();
            const errorDetails = { status: response.status, body: errorBody };
            logger.error(`[${operation}] Failed to list models`, { ...context, ...errorDetails });
            // Context is not passed to McpError constructor directly.
            throw new McpError(BaseErrorCode.INTERNAL_ERROR, `OpenRouter list models failed (${response.status})`, errorDetails);
          }

          const models = await response.json();
          logger.info(`[${operation}] Successfully listed models`, context);
          // logger.debug(`[${operation}] Models data`, { ...context, count: models?.data?.length });
          return models;
        } catch (error: any) {
          logger.error(`[${operation}] Error listing models`, { ...context, error: error.message });
          if (error instanceof McpError) {
            throw error; // Re-throw McpErrors directly
          }
          // Use SERVICE_UNAVAILABLE for network/fetch errors
          // Context is not passed to McpError constructor directly.
          throw new McpError(BaseErrorCode.SERVICE_UNAVAILABLE, `Network error listing OpenRouter models: ${error.message}`, { cause: error });
        }
      },
      {
        operation,
        context,
        errorCode: BaseErrorCode.INTERNAL_ERROR, // Default error code if unexpected error occurs
      }
    );
  }
}

// Initialize and export the service instance.
// It reads the API key from the config/environment variables.
// The instance will always exist, but its status indicates if it's usable.
const openRouterProviderInstance = new OpenRouterProvider(config.openrouterApiKey);

// Export the guaranteed instance. Consumers should check its status or handle errors from its methods.
export { openRouterProviderInstance as openRouterProvider };
export type { OpenRouterProvider }; // Export type for dependency injection/typing
