// Type definitions for the MCP (Message Control Protocol) protocol
// and standard JSON-RPC 2.0 structures

// ==================================
// Standard JSON-RPC 2.0 Types
// ==================================

/**
 * Represents a JSON-RPC 2.0 Request object.
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[] | object; // Can be array or object
  id: string | number | null; // Can be string, number, or null for notifications
}

/**
 * Represents a JSON-RPC 2.0 Notification object (request without id).
 */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[] | object;
}

/**
 * Represents a JSON-RPC 2.0 Success Response object.
 */
export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  result: unknown; // The actual result payload
  id: string | number | null; // Must match the request id
}

/**
 * Represents the Error object within a JSON-RPC 2.0 Error Response.
 */
export interface JsonRpcErrorObject {
  code: number; // Standard JSON-RPC error codes or custom codes
  message: string;
  data?: unknown; // Optional additional data about the error
}

/**
 * Represents a JSON-RPC 2.0 Error Response object.
 */
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  error: JsonRpcErrorObject;
  id: string | number | null; // Must match the request id, or null if request id couldn't be determined
}

/**
 * Represents any valid JSON-RPC 2.0 Response object (Success or Error).
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// Standard JSON-RPC 2.0 Error Codes
export enum JsonRpcErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  // -32000 to -32099 are reserved for implementation-defined server-errors.
  SERVER_ERROR_START = -32000,
  SERVER_ERROR_END = -32099,
}


// ==================================
// MCP Specific Content Types (Likely used within JsonRpcResponse.result)
// ==================================

// Common response types for tool results
export interface McpContent {
  type: "text"; // Could be extended later (e.g., 'image', 'json')
  text: string;
}

export interface McpToolResult { // Renamed from McpToolResponse for clarity
  content: McpContent[];
  // isError is handled by the main JsonRpcErrorResponse structure
}

// Resource response types
export interface ResourceContent {
  uri: string;
  text: string;
  mimeType?: string;
}

export interface McpResourceResult { // Renamed from ResourceResponse
  contents: ResourceContent[];
}

// Prompt response types (Potentially less relevant for strict JSON-RPC tools/resources)
export interface PromptMessageContent {
  type: "text";
  text: string;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: PromptMessageContent;
}

export interface McpPromptResult { // Renamed from PromptResponse
  messages: PromptMessage[];
}

// ==================================
// Helper Functions (Updated for JSON-RPC context)
// ==================================

/**
 * Creates a JSON-RPC 2.0 Success Response containing an McpToolResult.
 */
export const createJsonRpcToolSuccessResponse = (id: string | number | null, text: string): JsonRpcSuccessResponse => ({
  jsonrpc: "2.0",
  result: {
    content: [{ type: "text", text }]
  } as McpToolResult,
  id
});

/**
 * Creates a JSON-RPC 2.0 Error Response.
 */
export const createJsonRpcErrorResponse = (id: string | number | null, code: number, message: string, data?: unknown): JsonRpcErrorResponse => ({
  jsonrpc: "2.0",
  error: {
    code,
    message,
    ...(data !== undefined && { data }) // Include data only if provided
  },
  id
});

/**
 * Creates a JSON-RPC 2.0 Success Response containing an McpResourceResult.
 */
export const createJsonRpcResourceSuccessResponse = (id: string | number | null, uri: string, text: string, mimeType?: string): JsonRpcSuccessResponse => ({
  jsonrpc: "2.0",
  result: {
    contents: [{ uri, text, mimeType }]
  } as McpResourceResult,
  id
});

// Note: PromptResponse helper might need adjustment depending on how prompts fit into JSON-RPC
export const createPromptResponse = (text: string, role: "user" | "assistant" = "assistant"): McpPromptResult => ({
  messages: [{
    role,
    content: {
      type: "text",
      text
    }
  }]
});
