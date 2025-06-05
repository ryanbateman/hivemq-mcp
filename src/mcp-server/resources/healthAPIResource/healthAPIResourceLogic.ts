/**
 * @fileoverview Defines the core logic, schemas, and types for the `Health API` resource.
 * This module includes a Zod schema for query parameter validation, type definitions,
 * and the main processing function that constructs the resource response.
 * The health API resource is designed to return status of the Broker and its compoents, typically extracted from the
 * request URI's path or query parameters, along with a timestamp.
 * @module src/mcp-server/resources/healthAPIResource/healthAPIResourceLogic
 */

import { z } from "zod";
import { fetchWithTimeout, logger, type RequestContext } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";

/**
 * Zod schema defining expected query parameters for the echo resource.
 *
 * This schema is intended for validating parameters passed via the URI's query string
 * (e.g., `health://component_name`).
 * Path parameters, such as `{component_name}` in a template like `health://{component_name}`,
 * are typically defined in the `ResourceTemplate` (see `registration.ts`) and
 * extracted by the MCP SDK from the URI path. The SDK merges these path
 * parameters into the `params` object passed to the handler.
 *
 */
export const HealthAPIResourceQuerySchema = z.object({
  /**
   * Optional component to get the specific details.
   */
  component: z
    .string()
    .optional()
    .default("")
    .describe(
      "Optional component to specifically query. If not provided, the status of the cluster generally may be used.",
    ),
});

/**
 * TypeScript type inferred from the {@link HealthAPIResourceQuerySchema}.
 * Represents the validated query parameters that might be passed to the Health API resource.
 */
export type HealthAPIResourceParams = z.infer<typeof HealthAPIResourceQuerySchema>;

/**
 * Defines the structure of the JSON payload returned by the `processHealthAPIResource` function.
 * This object is typically JSON-stringified by the resource handler before being sent
 * as the resource content.
 *
 * @property status - The status of the component that is being specifically queried. 
 * @property timestamp - An ISO 8601 timestamp indicating when the response was generated.
 * @property requestUri - The full URI of the original resource request.
 */
export interface HealthAPIResourceResponsePayload {
  /** The message that is being echoed. */
  status: string;
}

/**
 * Processes the core logic for an Health API resource request.
 * It constructs a response payload containing the details of the request,
 * the current timestamp, and the original request URI.
 *
 *
 * @param uri - The full URL object of the incoming resource request.
 * @param params - The validated query parameters for the request.
 *   This object also includes path parameters merged by the SDK, with query parameters
 *   taking precedence in case of name conflicts.
 * @param context - The request context, used for logging and tracing the operation.
 * @returns The data payload for the response.
 *   This payload is typically JSON-stringified by the calling handler.
 */
export const processHealthAPIResource = async (
  uri: URL,
  context: RequestContext,
): Promise<HealthAPIResourceResponsePayload> => {
  // The `params.component` can originate from a query parameter (validated by `HealthAPIResourceQuerySchema`)
  // or a path parameter (e.g., from a template like `health://{component}`).
  // The MCP SDK merges these, with query parameters taking precedence over path parameters if names conflict.
  // const componentToQuery = params.component || `Default component from ${uri.pathname}`;
  const componentToQuery = ``;
  logger.debug("Processing health API resource logic.", {
    ...context,
    resourceUri: uri.href,
    extractedMessage: componentToQuery,
    queryParamMessage: '',
  });


  const API_TIMEOUT_MS = 5000;

  try {
    // Process the message according to the requested mode
    const url = new URL("http://localhost:8889/api/v1/health/");

    // Fetch and process the response
    const response = await fetchWithTimeout(
      url.toString(),
      API_TIMEOUT_MS,
      context
    );

    if (!response.ok) {
      logger.error("Error fetching health of Broker", { ...context, status: response.status, statusText: response.statusText });
      const errorText = await response.text();
      throw new McpError(
        BaseErrorCode.SERVICE_UNAVAILABLE,
        `All Clients API request failed: ${response.status} ${response.statusText}`,
        {
          ...context,
          httpStatusCode: response.status,
          responseBodyBrief: errorText.substring(0, 200), // Log a snippet of the response
          errorSource: "CatFactApiNonOkResponse",
        },
      );
    }

    // Parse the JSON response
    const data = await response.json();
    logger.info("API response received", { ...context, responseData: data });

    // Return the properly formatted response

    const responsePayload: HealthAPIResourceResponsePayload = {
      status: data
    }

    return responsePayload;
  } catch (error) {
    // The fetchWithTimeout utility handles AbortError and throws McpError with BaseErrorCode.TIMEOUT.
    // It also wraps other fetch-related network errors in McpError.
    // So, we primarily need to catch McpErrors here or wrap any truly unexpected errors.

    if (error instanceof McpError) {
      // Log McpErrors specifically if needed, or just re-throw
      // If it's a TIMEOUT error from fetchWithTimeout, it's already logged by the utility.
      // If it's a SERVICE_UNAVAILABLE from fetchWithTimeout (generic network error), also logged.
      // If it's from response.ok check above, it's also an McpError.
      throw error;
    }

    // Fallback for any other unexpected errors not already wrapped by McpError
    logger.error(
      `Unexpected error during API processing for the All Clients API call: ${error instanceof Error ? error.message : String(error)}`,
      context,
    );
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR, // Or UNKNOWN_ERROR if more appropriate
      `Unexpected error processing response from All Clients API call: ${error instanceof Error ? error.message : String(error)}`,
      {
        ...context,
        originalErrorName: error instanceof Error ? error.name : "UnknownError",
        errorSource: "AllClientsToolUnexpectedCatch",
      },
    );
  }
};
