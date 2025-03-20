import { z } from 'zod';

/**
 * Schema for validating echo resource query parameters
 */
export const EchoResourceQuerySchema = z.object({
  message: z.string().optional()
    .describe('Message to echo back in the response')
}).describe(
  'Query parameters for the echo resource.\n' +
  'URI Format: echo://message'
);

export type EchoResourceQuery = z.infer<typeof EchoResourceQuerySchema>;

/**
 * Response type for the echo resource, matching MCP SDK expectations
 */
export interface EchoResourceResponse {
  [key: string]: unknown;
  contents: [{
    uri: string;                   // URI identifying this resource
    text: string;                  // JSON string of EchoData
    mimeType: "application/json";  // Always JSON for this resource
  }];
}

/**
 * Data structure for the echo response
 */
export interface EchoData {
  message: string;              // The echoed message
  timestamp: string;            // When the request was processed
  requestUri: string;           // The original request URI
}