import { z } from "zod";
import { McpContent, McpToolResponse } from "./mcp.js";

// Base error codes that all tools can use
export enum BaseErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// Base MCP error class
export class McpError extends Error {
  constructor(
    public code: BaseErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'McpError';
  }

  toResponse(): McpToolResponse {
    const content: McpContent = {
      type: "text",
      text: `Error [${this.code}]: ${this.message}${
        this.details ? `\nDetails: ${JSON.stringify(this.details, null, 2)}` : ''
      }`
    };

    return {
      content: [content],
      isError: true
    };
  }
}

// Error schema for validation
export const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional()
});

export type ErrorResponse = z.infer<typeof ErrorSchema>;