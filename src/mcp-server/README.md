# MCP Server Implementation

[![Model Context Protocol](https://img.shields.io/badge/MCP-1.0-green.svg)](https://modelcontextprotocol.ai/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

This directory contains the Model Context Protocol (MCP) server implementation, including example tools, resources, and server utilities.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [What is MCP?](#what-is-mcp)
- [Core Concepts](#core-concepts)
  - [Server](#server)
  - [Resources](#resources)
  - [Tools](#tools)
- [Implementation Details](#implementation-details)
- [Extending the Server](#extending-the-server)
  - [Adding New Tools](#adding-new-tools)
  - [Adding New Resources](#adding-new-resources)
- [Best Practices](#best-practices)

## Overview

The Model Context Protocol server enables AI models to interact with your application through standardized interfaces. This directory contains:

- **Example implementations** of both [tools](#tools) and [resources](#resources)
- **Registration helpers** for simplified component setup
- **Core server infrastructure** for handling MCP protocol messages

## Directory Structure

- **[resources/](resources/)** - Resource implementations
  - **[echoResource/](resources/echoResource/README.md)** - Example resource that returns echo messages
- **[tools/](tools/)** - Tool implementations
  - **[echoTool/](tools/echoTool/README.md)** - Example tool that processes messages
- **[utils/](utils/README.md)** - Server-specific utilities for registration

## What is MCP?

The [Model Context Protocol (MCP)](https://modelcontextprotocol.ai) is a framework that enables AI systems to interact with external tools and resources. It allows language models to:

- Execute **tools** that perform actions and return results
- Access structured **resources** that provide information
- Interact with your application through standardized interfaces

MCP follows a client-server architecture where:

- **Hosts** are LLM applications (like Claude Desktop or IDEs) that initiate connections
- **Clients** maintain connections with servers, inside the host application
- **Servers** (what this directory implements) provide context, tools, and prompts to clients

## Core Concepts

### Server

The MCP Server is your core interface to the protocol. It handles:

- Connection management
- Protocol compliance
- Message routing
- Tool and resource registration

The server handles incoming requests from clients and routes them to the appropriate handlers:

```typescript
// Simplified server initialization
const server = new McpServer({
  name: "MCP Template Server",
  version: "1.0.0"
});

// Register components
await registerEchoTool(server);
await registerEchoResource(server);

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Resources

Resources expose data to LLMs. They're similar to GET endpoints in a REST API - they provide information but don't perform significant computation or have side effects.

Resources are identified by URIs and can be:

- **Static**: Concrete resources with fixed URIs
- **Dynamic**: Resource templates with parameterized URIs

The [Echo Resource](resources/echoResource/README.md) demonstrates:

```typescript
// Resource template registration
server.resource(
  "echo-resource",
  new ResourceTemplate("echo://{message}", { /* template options */ }),
  async (uri, params) => {
    // Handle resource request
    return {
      contents: [{
        uri: uri.href,
        text: `Echo resource: ${params.message}`,
        mimeType: "application/json"
      }]
    };
  }
);
```

### Tools

Tools allow LLMs to take actions through your server. Unlike resources, tools are expected to perform computation and have side effects.

The [Echo Tool](tools/echoTool/README.md) demonstrates:

```typescript
// Tool registration
server.tool(
  "echo_message",
  {
    message: z.string().min(1).max(1000),
    mode: z.enum(['standard', 'uppercase', 'lowercase']).optional()
  },
  async (params) => {
    // Handle tool invocation
    return {
      content: [{
        type: "text",
        text: JSON.stringify(processEchoMessage(params))
      }]
    };
  }
);
```

## Implementation Details

The server implementation in this template uses:

1. **Registration Helpers**: Utilities for consistent component registration
2. **Error Handling**: Standardized error processing
3. **Logging**: Detailed, structured logging with context
4. **Validation**: Input validation using Zod schemas
5. **Transport**: Stdio transport for local process communication

### Server Initialization

The server is initialized in `src/index.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerEchoTool } from "./mcp-server/tools/echoTool/index.js";
import { registerEchoResource } from "./mcp-server/resources/echoResource/index.js";

async function main() {
  // Create MCP server
  const server = new McpServer({
    name: "MCP Template Server",
    version: "1.0.0"
  });

  // Register components
  await registerEchoTool(server);
  await registerEchoResource(server);

  // Connect with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

## Extending the Server

### Adding New Tools

To add a new tool:

1. Create a directory in `src/mcp-server/tools/` for your tool
2. Define types and schemas in a `types.ts` file
3. Implement the handler logic in a separate file
4. Create an `index.ts` file that registers the tool
5. Add your tool to the server initialization in `src/index.ts`

Example tool registration:

```typescript
export const registerMyTool = async (server: McpServer): Promise<void> => {
  return registerTool(
    server,
    { name: "my_tool" },
    async (server, logger) => {
      server.tool(
        "my_tool",
        {
          param1: z.string().describe('First parameter'),
          param2: z.number().optional().describe('Second parameter')
        },
        async (params) => {
          // Tool implementation
          return {
            content: [{
              type: "text",
              text: JSON.stringify(result)
            }]
          };
        }
      );
    }
  );
};
```

### Adding New Resources

To add a new resource:

1. Create a directory in `src/mcp-server/resources/` for your resource
2. Define types and schemas in a `types.ts` file
3. Implement the handler logic in a separate file
4. Create an `index.ts` file that registers the resource
5. Add your resource to the server initialization in `src/index.ts`

Example resource registration:

```typescript
export const registerMyResource = async (server: McpServer): Promise<void> => {
  return registerResource(
    server,
    { name: "my-resource" },
    async (server, logger) => {
      const template = new ResourceTemplate(
        "my-resource://{id}",
        {
          list: async () => ({
            resources: [{
              uri: "my-resource://example",
              name: "Example Resource",
              description: "An example resource"
            }]
          }),
          complete: {}
        }
      );

      server.resource(
        "my-resource",
        template,
        {
          name: "My Resource",
          description: "Custom resource implementation",
          querySchema: z.object({
            id: z.string().describe('Resource identifier')
          })
        },
        async (uri, params) => {
          // Resource implementation
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(data),
              mimeType: "application/json"
            }]
          };
        }
      );
    }
  );
};
```

## Best Practices

When implementing MCP components:

### For Tools

1. **Clear Descriptions**: Provide detailed descriptions and parameter documentation
2. **Input Validation**: Validate all inputs thoroughly with Zod schemas
3. **Error Handling**: Return proper error responses with meaningful messages
4. **Security**: Sanitize and validate all inputs
5. **Response Format**: Follow MCP response format conventions

### For Resources

1. **URI Structure**: Use clear, descriptive URI templates
2. **MIME Types**: Specify proper MIME types for resources
3. **Content Format**: Structure resource content appropriately
4. **Error Cases**: Handle all potential error scenarios
5. **Performance**: Consider caching for expensive resource operations

### General

1. **Use Registration Helpers**: They provide consistent error handling and logging
2. **Create Child Loggers**: Use component-specific loggers for better log organization
3. **Centralized Error Handling**: Use the ErrorHandler for consistent error processing
4. **Consistent Naming**: Follow naming conventions for tools and resources
5. **Documentation**: Document your components with README files and code comments