/**
 * @fileoverview Defines the core logic, schemas, and types for the `All clients` tool.
 * This module includes input validation using Zod, type definitions for input and output,
 * and the main processing function that the requests to list all clients.
 * @module src/mcp-server/tools/allClientsTool/allClientsToolLogic
 */

import { z } from "zod";
import { logger, type RequestContext } from "../../../utils/index.js";
import { ClientId, Clients } from "../../../types-global/hivemq.js";

/**
 * Zod schema defining the input parameters for the `all_clients` tool.
 * This schema is used by the MCP SDK to validate the arguments provided when the tool is called.
 */
export const AllClientsInputSchema = z
  .object({
    limit: z
      .number()
      .min(50, "Message cannot be empty.")
      .max(2500, "Message cannot exceed 1000 characters.")
      .default(50)
      .describe(
        "'Specifies the page size for the returned MQTT Client results. (50-2500)'",
      ),
    cursor: z
    .string().
    optional().
    describe(
        'The cursor that has been returned by the previous result page. Used to paginate through results. Do not pass if you require the first page.'
    )
  })
  .describe(
    "Zod schema for validating the input arguments for the all_clients tool.",
  );

/**
 * TypeScript type inferred from `AllClientsToolInputSchema`.
 * Represents the validated input parameters for the all clients tool.
 */
export type AllClientsInput = z.infer<typeof AllClientsInputSchema>;

/**
 * Defines the structure of the JSON payload returned by the `all_clients` tool handler.
 * This object is JSON-stringified and placed within the `text` field of the
 * `CallToolResult`'s `content` array.
 */
// Define the type based on Zod schema inference
type ClientIdType = z.infer<typeof ClientId>;
type ClientsType = z.infer<typeof Clients>;

export interface AllClientsResponse {
  limit: string;
  items: ClientIdType[];    
}

export interface AllClientsResponse {
  limit: string;
  items: ClientIdType[];    
}

// --- Core Logic Function ---

/**
 * Processes the core logic for the AllClients tool.
 * Returns the list of all currently connected clients.
 *
 * @function processAllClientsMessage
 * @param {AllClientsToolInput} params - The validated input parameters for the echo tool.
 * @param {RequestContext} context - The request context for logging and tracing.
 * @returns {AllClientsResponse} The processed response data, including original message, formatted/repeated message, and optional timestamp.
 */
export const processAllClientsMessage = async (
  params: AllClientsInput,
  context: RequestContext // Add context parameter
): Promise<AllClientsResponse> => {
  // Use the passed context for logging
  logger.debug("Processing all clients tool logic", { ...context, inputMessage: params.cursor, mode: params.limit });

  // Process the message according to the requested mode
  const url = new URL("http://localhost:8000/api/v1/mqtt/clients/");
  url.searchParams.append("limit", params.limit.toString());
  if (params.cursor != null) {
    url.searchParams.append("cursor", params.cursor);
  }

  // Fetch and process the response
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    logger.error("Error fetching clients", { ...context, status: response.status, statusText: response.statusText });
    throw new Error(`Failed to fetch clients: ${response.status} ${response.statusText}`);
  }
  
  // Parse the JSON response
  const data = await response.json();
  logger.info("API response received", { ...context, responseData: data });
  
  // Return the properly formatted response
  return {
    limit: params.limit.toString(),
    items: data.items || []
  };
};