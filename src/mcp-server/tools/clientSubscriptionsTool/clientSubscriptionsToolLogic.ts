/**
 * @fileoverview Defines the core logic, schemas, and types for the `Client subscriptions` tool.
 * This module includes input validation using Zod, type definitions for input and output,
 * and the main processing function that the requests to list the subscriptions for a specific client.
 * @module src/mcp-server/tools/clientSubscriptionsTool/clientSubscriptionsToolLogic
 */

import { z } from "zod";
import { config } from "../../../config/index.js";
import { fetchWithTimeout, logger, type RequestContext } from "../../../utils/index.js";
import { ClientSubscriptions } from "../../../types-global/hivemq.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";

/**
 * Zod schema defining the input parameters for the `client_details` tool.
 * This schema is used by the MCP SDK to validate the arguments provided when the tool is called.
 */
export const ClientSubscriptionsInputSchema = z
  .object({
    clientId: z
      .string()
      .min(1, "ClientID cannot be empty.")
      .describe(
        "'Specifies the ID of the client whose subscriptions you are requesting'",
      )
  })
  .describe(
    "Zod schema for validating the input arguments for the clientSubscriptions tool.",
  );

/**
 * TypeScript type inferred from `ClientSubscriptionsToolInputSchema`.
 * Represents the validated input parameters for the client subscriptions tool.
 */
export type ClientSubscriptionsInput = z.infer<typeof ClientSubscriptionsInputSchema>;

/**
 * Defines the structure of the JSON payload returned by the `client_subscriptions` tool handler.
 * This object is JSON-stringified and placed within the `text` field of the
 * `CallToolResult`'s `content` array.
 */
// Define the type based on Zod schema inference
type ClientSubscriptionsType = z.infer<typeof ClientSubscriptions>;

export interface ClientSubscriptionsResponse {
  subscriptions: ClientSubscriptionsType;
  client: string;
}
// --- Core Logic Function ---

/**
 * Processes the core logic for the ClientDetails tool.
 * Returns the details of a client.
 *
 * @function processClientSubscriptionsMessage
 * @param {ClientSubscriptionsToolInput} params - The validated input parameters for the client details tool.
 * @param {RequestContext} context - The request context for logging and tracing.
 * @returns {ClientSubscriptionsResponse} The processed response data, including the client details.
 */
export const processClientSubscriptionsMessage = async (
  params: ClientSubscriptionsInput,
  context: RequestContext // Add context parameter
): Promise<ClientSubscriptionsResponse> => {
  // Use the passed context for logging
  logger.debug("Processing client subscriptions tool logic", { ...context, clientId: params.clientId });

  const API_TIMEOUT_MS = 5000;

  try {
    // Process the message according to the requested mode
    const url = new URL(`http://${config.hiveMQHost}:8000/api/v1/mqtt/clients/${params.clientId}/subscriptions`);

    // Fetch and process the response
    const response = await fetchWithTimeout(
      url.toString(),
      API_TIMEOUT_MS,
      context
    );

    if (!response.ok) {
      logger.error("Error fetching client subscriptions", { ...context, status: response.status, statusText: response.statusText });
      const errorText = await response.text();
      throw new McpError(
        BaseErrorCode.SERVICE_UNAVAILABLE,
        `Client subscriptions API request failed: ${response.status} ${response.statusText}`,
        {
          ...context,
          httpStatusCode: response.status,
          responseBodyBrief: errorText.substring(0, 200), // Log a snippet of the response
          errorSource: "ClientsubscriptionsNonOkResponse",
        },
      );
    }

    // Parse the JSON response
    const data = await response.json();
    logger.info("API response received", { ...context, responseData: data });

    // Return the properly formatted response
    return {
      client: params.clientId,
      subscriptions: data
    }

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