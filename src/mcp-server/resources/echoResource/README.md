# Echo Resource: Simple MCP Resource Example 🔊

This directory contains an example MCP resource implementation that echoes back messages. It serves as a practical demonstration of how to build and register resources with the MCP server.

## What's Inside

- **[Types](#types)** - Resource-specific type definitions
- **[Implementation](#implementation)** - Echo processing logic
- **[Registration](#registration)** - Resource registration with the MCP server

## How It Works

The Echo Resource is a simple yet complete example of an MCP resource. When accessed via a URI like `echo://hello` or with query parameters like `?message=Hello`, it returns a JSON response containing the provided message, a timestamp, and the original request URI.

```typescript
// Example usage
const response = await access_mcp_resource({
  server_name: "mcp-ts-template",
  uri: "echo://Hello world"
});

// Response will contain:
// {
//   "message": "Hello world",
//   "timestamp": "2023-06-12T15:23:45.678Z",
//   "requestUri": "echo://Hello world"
// }
```

## Types

The `types.ts` file defines the schemas and interfaces used by the resource:

```typescript
// Use Zod for runtime validation
export const EchoResourceQuerySchema = z.object({
  message: z.string().optional()
    .describe('Message to echo back in the response')
});

// Response data structure
export interface EchoData {
  message: string;        // The echoed message
  timestamp: string;      // When the request was processed
  requestUri: string;     // The original request URI
}
```

## Implementation

The resource processor in `getEchoMessage.ts` handles incoming requests:

1. Creates a request context with unique ID
2. Sanitizes and validates query parameters
3. Processes the request and generates a response
4. Formats the response according to MCP standards
5. Handles errors with appropriate error codes

```typescript
// The main processing function
export const getEchoMessage = async (uri: URL): Promise<EchoResourceResponse> => {
  // Implementation details...
  
  // Extract message or use default
  const message = validatedQuery.message || 'Hello from echo resource!';
  
  // Return formatted response
  return {
    contents: [{
      uri: uri.href,
      text: JSON.stringify(responseData, null, 2),
      mimeType: "application/json"
    }]
  };
};
```

## Registration

The `index.ts` file registers the resource with the MCP server:

```typescript
export const registerEchoResource = async (server: McpServer): Promise<void> => {
  return registerResource(
    server,
    { name: "echo-resource" },
    async (server, resourceLogger) => {
      // Create a resource template
      const template = new ResourceTemplate(
        "echo://{message}",
        {
          list: async () => ({
            resources: [{
              uri: "echo://hello",
              name: "Default Echo Message",
              description: "A simple echo resource example"
            }]
          }),
          complete: {}
        }
      );

      // Register with the server
      server.resource(
        "echo-resource",
        template,
        {
          name: "Echo Message",
          description: "A simple echo resource that returns a message",
          mimeType: "application/json",
          // Schema and examples...
        },
        // Handler function...
      );
    }
  );
};
```

## Learning from Echo Resource

This example demonstrates several best practices:

1. **Clean Separation of Concerns**
   - Types and schemas in a dedicated file
   - Processing logic separate from registration
   - Registration using helper functions

2. **Proper Error Handling**
   - Input validation with meaningful error messages
   - Consistent error handling with ErrorHandler
   - Error mapping for domain-specific errors

3. **Security Practices**
   - Input sanitization
   - Parameter validation
   - Request context tracking

4. **Documentation**
   - Clear comments
   - Type descriptions
   - Examples in the registration

## Creating Your Own Resources

To create your own resource following this pattern:

1. Define your types and schemas in a `types.ts` file
2. Create your processing logic in a handler file
3. Register your resource in an `index.ts` file using the registration helper
4. Use the ErrorHandler for consistent error handling
5. Include proper logging throughout your code

```typescript
// Example resource registration
export const registerYourResource = async (server: McpServer): Promise<void> => {
  return registerResource(
    server,
    { name: "your-resource" },
    async (server, logger) => {
      // Create your resource template
      const template = new ResourceTemplate("your://resource/{id}", {
        // Template options...
      });

      // Register your resource
      server.resource(
        "your-resource",
        template,
        {
          name: "Your Resource",
          description: "Description of your resource",
          // Resource metadata...
        },
        // Your handler function
        async (uri, params) => {
          // Resource processing...
        }
      );
    }
  );
};