import { z } from 'zod';

/**
 * Zod schema for validating echo resource URI parameters derived from the template `echo://{message}`.
 * Ensures the 'message' part of the URI is present and is a string.
 */
export const EchoResourceParamsSchema = z.object({
  /** The message extracted from the URI path. */
  message: z.string()
    .min(1, "Message parameter cannot be empty") // Add validation for non-empty
    .describe('Message to echo back in the response, extracted from the URI path segment.')
}).describe(
  'Defines the parameters extracted from the echo resource URI.\n' +
  'Expected URI Format: echo://{message}'
);

/**
 * TypeScript type inferred from `EchoResourceParamsSchema`.
 * Represents the validated parameters extracted from the resource URI.
 * @typedef {z.infer<typeof EchoResourceParamsSchema>} EchoResourceParams
 */
export type EchoResourceParams = z.infer<typeof EchoResourceParamsSchema>;

/**
 * Defines the structure of the JSON payload returned by the echo resource handler.
 * This object is JSON-stringified and placed within the `text` field of the
 * `ReadResourceResult`'s `contents` array.
 */
export interface EchoResponsePayload {
  /** The message that was echoed. */
  message: string;
  /** ISO 8601 timestamp indicating when the response was generated. */
  timestamp: string;
  /** The original URI requested by the client. */
  requestUri: string;
}

// Removed EchoResourceResponse interface as it was inaccurate and redundant.
// The resource handler returns a standard ReadResourceResult from the SDK,
// where the `contents[0].text` field contains a JSON string matching EchoResponsePayload.
// The `contents[0].mimeType` is "application/json".
