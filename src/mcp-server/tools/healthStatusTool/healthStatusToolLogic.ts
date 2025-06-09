/**
 * @fileoverview Defines the core logic, schemas, and types for the `Health Status` tool.
 * This module includes input validation using Zod, type definitions for input and output,
 * and the main processing function that the requests to list all clients.
 * @module src/mcp-server/tools/healthStatusTool/HealthStatusToolLogic
 */

import { z } from "zod";
import { config } from "../../../config/index.js";
import { fetchWithTimeout, logger, type RequestContext } from "../../../utils/index.js";
import { McpError, BaseErrorCode } from "../../../types-global/errors.js";

/**
 * Zod schema defining the input parameters for the `all_clients` tool.
 * This schema is used by the MCP SDK to validate the arguments provided when the tool is called.
 */

/**
 * Defines the structure of the JSON payload returned by the `health_status` tool handler.
 * This object is JSON-stringified and placed within the `text` field of the
 * `CallToolResult`'s `content` array.
 */
// Define the type based on Zod schema inference

export interface HealthComponent {

}

export interface HealthStatusResponse {
  status: string;
  components: HealthComponent[];
}

// --- Core Logic Function ---

/**
 * Processes the core logic for the AllClients tool.
 * Returns the list of all currently connected clients.
 *
 * @function processHealthStatusRequest
 * @param {RequestContext} context - The request context for logging and tracing.
 * @returns {HealthStatusResponse} The processed response data.
 */
export const processHealthStatusRequest = async (
  context: RequestContext // Add context parameter
): Promise<HealthStatusResponse> => {
  // Use the passed context for logging
  logger.debug("Processing health status tool logic", { ...context});

  const API_TIMEOUT_MS = 5000;

  try {
    // Process the message according to the requested mode
    const url = new URL(`http://${config.hiveMQHost}:8889/api/v1/health/`);
    
    // Fetch and process the response
    const response = await fetchWithTimeout(
      url.toString(),
      API_TIMEOUT_MS,
      context
    );

    if (!response.ok && response.status != 503) {
      logger.error("Error fetching health status", { ...context, status: response.status, statusText: response.statusText });
      const errorText = await response.text();
      throw new McpError(
        BaseErrorCode.SERVICE_UNAVAILABLE,
        `Health status request failed: ${response.status} ${response.statusText}`,
        {
          ...context,
          httpStatusCode: response.status,
          responseBodyBrief: errorText.substring(0, 200), // Log a snippet of the response
          errorSource: "HealthStatusApiNonOkResponse",
        },
      );
    }

    // Parse the JSON response
    const data = await response.json();
    logger.info("API response received", { ...context, responseData: data });

    // Return the properly formatted response
    return {
      "status": data.status,
      "components": data.components
    };

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