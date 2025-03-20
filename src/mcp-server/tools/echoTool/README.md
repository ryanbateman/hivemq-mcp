# Echo Tool: MCP Tool Example 🔄

This directory contains an example MCP tool implementation that echoes back formatted messages. It serves as a practical demonstration of how to build and register tools with the MCP server.

## What's Inside

- **[Types](#types)** - Tool-specific type definitions and schemas
- **[Handler](#handler)** - Echo processing implementation
- **[Registration](#registration)** - Tool registration with the MCP server

## How It Works

The Echo Tool takes a message and returns it with optional formatting. It demonstrates a complete MCP tool implementation with proper input validation, error handling, and response formatting.

```typescript
// Example usage
const response = await use_mcp_tool({
  server_name: "mcp-ts-template",
  tool_name: "echo_message",
  arguments: {
    message: "Hello world",
    mode: "uppercase",
    repeat: 2,
    timestamp: true
  }
});

// Response will contain:
// {
//   "originalMessage": "Hello world",
//   "formattedMessage": "HELLO WORLD",
//   "repeatedMessage": "HELLO WORLD HELLO WORLD",
//   "timestamp": "2023-06-12T15:23:45.678Z",
//   "mode": "uppercase",
//   "repeatCount": 2
// }
```

## Types

The `types.ts` file defines schemas and interfaces for the tool's input and output:

```typescript
// Available modes for the echo operation
export const ECHO_MODES = ['standard', 'uppercase', 'lowercase'] as const;

// Input schema with Zod for validation
export const EchoToolInputSchema = z.object({
  message: z.string().min(1).describe(
    'The message to echo back'
  ),
  mode: z.enum(ECHO_MODES).optional().default('standard').describe(
    'How to format the echoed message'
  ),
  // ... other fields
});

// Response structure
export interface EchoToolResponse {
  originalMessage: string;
  formattedMessage: string;
  repeatedMessage: string;
  timestamp?: string;
  mode: typeof ECHO_MODES[number];
  repeatCount: number;
}
```

## Handler

The `echoMessage.ts` file implements the main processing logic:

1. Extracts the request ID from the context
2. Sanitizes and validates input using Zod schema
3. Formats the message based on the selected mode
4. Repeats the message the specified number of times
5. Returns a properly formatted MCP response

```typescript
export const echoMessage = async (
  input: unknown,
  context: OperationContext
) => {
  // Implementation details...
  
  // Format based on mode
  switch (validatedInput.mode) {
    case 'uppercase':
      formattedMessage = validatedInput.message.toUpperCase();
      break;
    case 'lowercase':
      formattedMessage = validatedInput.message.toLowerCase();
      break;
    // 'standard' mode keeps the message as-is
  }
  
  // Return standardized response
  return {
    content: [{ 
      type: "text", 
      text: JSON.stringify(response, null, 2)
    }]
  };
};
```

## Registration

The `index.ts` file registers the tool with the MCP server:

```typescript
export const registerEchoTool = async (server: McpServer): Promise<void> => {
  return registerTool(
    server,
    { name: "echo_message" },
    async (server, toolLogger) => {
      // Register with the server
      server.tool(
        "echo_message", 
        {
          message: z.string().min(1).max(1000).describe(
            'The message to echo back (1-1000 characters)'
          ),
          // Other fields...
        },
        // Handler function
        async (params) => {
          // Implementation...
        }
      );
    }
  );
};
```

## Features Demonstrated

The Echo Tool demonstrates several important concepts and best practices:

### 1. Input Validation

The tool uses Zod for schema validation:
- Type checking (string, boolean, number)
- Range validation (min/max length, numeric bounds)
- Enum validation (for the mode parameter)
- Default values for optional parameters

### 2. Error Handling

The implementation shows robust error handling:
- Specific validation error messages
- Proper error classification (validation vs. internal)
- Consistent error context for debugging
- Use of the ErrorHandler utility for uniform handling

### 3. Security Practices

The tool follows good security practices:
- Input sanitization to prevent injection
- Parameter validation to enforce constraints
- Context tracking for auditability
- Safe logging (sanitizing potentially sensitive data)

### 4. Performance Considerations

The implementation includes performance optimizations:
- Length limits on input message
- Bounds on repeat count to prevent abuse
- Efficient string manipulation

## Creating Your Own Tools

To create your own tool following this pattern:

1. Define tool types and schemas in a `types.ts` file
2. Implement the handler logic in a well-structured file
3. Register the tool in an `index.ts` file using the registration helper

```typescript
// Example tool registration
export const registerYourTool = async (server: McpServer): Promise<void> => {
  return registerTool(
    server,
    { name: "your_tool_name" },
    async (server, logger) => {
      // Register your tool
      server.tool(
        "your_tool_name",
        {
          // Input schema using Zod
          param1: z.string().describe('Description of parameter 1'),
          param2: z.number().optional().describe('Optional numeric parameter')
        },
        // Handler function for your tool
        async (params) => {
          // Your tool processing logic
          // Return standardized response
        }
      );
    }
  );
};
```

## Usage Examples

### Basic usage
```typescript
await use_mcp_tool({
  server_name: "mcp-ts-template",
  tool_name: "echo_message",
  arguments: {
    message: "Hello world"
  }
});
```

### With formatting options
```typescript
await use_mcp_tool({
  server_name: "mcp-ts-template",
  tool_name: "echo_message",
  arguments: {
    message: "Hello world",
    mode: "uppercase",
    repeat: 3,
    timestamp: false
  }
});