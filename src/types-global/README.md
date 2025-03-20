# Types Global: Shared Type Definitions 🌐

This directory contains shared type definitions, interfaces, and tools used throughout the application. Think of this as the common language that different parts of your code use to communicate with each other.

## What's Inside

- **[Error Types](#error-types)** - Standard error handling
- **[MCP Protocol Types](#mcp-protocol-types)** - Message Control Protocol definitions
- **[Tool Types](#tool-types)** - Interfaces for tool registration and configuration

## Error Types

`errors.ts` provides standardized error handling across your application.

```typescript
import { BaseErrorCode, McpError } from '../types-global/errors.js';

// Use predefined error codes for consistency
throw new McpError(
  BaseErrorCode.NOT_FOUND,
  'User profile not found',
  { userId: '123' }
);

// Convert errors to standardized responses
const errorResponse = myError.toResponse();
```

### Key Features:

- ✅ Standard error codes enum for consistent error classification
- ✅ `McpError` class with code, message and optional details
- ✅ Automatic conversion to response format
- ✅ Zod schema for validation

## MCP Protocol Types

`mcp.ts` defines the core types for the Message Control Protocol (MCP).

```typescript
import { createToolResponse, createResourceResponse } from '../types-global/mcp.js';

// Create a tool response with helper functions
const response = createToolResponse('Operation completed successfully');

// Create a resource response
const resourceResponse = createResourceResponse(
  'resource://example/123',
  'Resource content here',
  'text/plain'
);
```

### Included Types:

- 📝 Content definitions for text responses
- 🔄 Tool response interfaces
- 🗂️ Resource response interfaces
- 💬 Prompt message types
- 🛠️ Helper functions for creating standardized responses

## Tool Types

`tool.ts` contains types and utilities for tool definition and registration.

```typescript
import { 
  createToolExample, 
  createToolMetadata, 
  registerTool 
} from '../types-global/tool.js';

// Define example usage
const example = createToolExample(
  { query: 'weather in New York' },
  '{"temp": 72, "conditions": "sunny"}',
  'Get current weather for a location'
);

// Create tool metadata
const metadata = createToolMetadata({
  examples: [example],
  allowUnauthenticated: true
});

// Register the tool with server
await registerTool(
  server,
  'getWeather',
  'Get current weather for a location',
  { query: z.string() },
  handleWeatherRequest,
  metadata
);
```

### Key Components:

- 📋 Tool metadata and example interfaces
- 🔐 Options for authentication requirements
- ⚡ Rate limiting configuration
- 🧩 Helper functions for tool registration

## How to Use These Types

These types should be imported directly from their respective files:

```typescript
// Import specific types
import { McpError, BaseErrorCode } from '../types-global/errors.js';
import { McpToolResponse } from '../types-global/mcp.js';
import { ToolMetadata } from '../types-global/tool.js';

// Or import everything from a file
import * as ErrorTypes from '../types-global/errors.js';
```

## Best Practices

- Use the standardized `McpError` class instead of throwing raw errors
- Leverage helper functions like `createToolResponse` for consistent responses
- When creating tools, always include descriptive examples
- Use the type definitions to ensure consistent interfaces across your app