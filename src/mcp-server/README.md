# 🧩 Extending the MCP Server

This document provides guidance on adding custom Tools and Resources to the MCP Server, enabling you to expand its capabilities. The server is designed for extensibility, leveraging the high-level abstractions provided by the Model Context Protocol (MCP) SDK.

---

## Adding Your Own Tools & Resources

The core of extending this MCP server involves defining your custom logic and then registering it with the main server instance. This process is streamlined by the MCP SDK's helper functions.

### 🛠️ General Workflow

1.  **Create Directories**:
    Organize your new features by creating dedicated directories:

    - For Tools: `src/mcp-server/tools/yourToolName/`
    - For Resources: `src/mcp-server/resources/yourResourceName/`

2.  **Implement Logic (`logic.ts`)**:
    Within your new directory, create a `logic.ts` file. This is where you'll define:

    - **Input/Output Schemas**: Use Zod to define clear and validated schemas for the inputs your tool will accept and the outputs it will produce. This is crucial for type safety and for the MCP host to understand how to interact with your tool.
    - **Core Processing Function**: Write the main function that performs the action of your tool or retrieves the data for your resource. This function will receive validated arguments (for tools) or parameters (for resources).

3.  **Register with the Server (`registration.ts`)**:
    Create a `registration.ts` file in your new directory. This file will:

    - Import your logic and schemas.
    - Import the `McpServer` type from the SDK and the `ErrorHandler` utility.
    - **Use High-Level SDK Abstractions (Strongly Recommended)**:
      - **For Tools**: Use `server.tool(name, description, zodSchemaShape, async handler => { ... })`.
        - `name`: A unique identifier for your tool (e.g., `get_weather_forecast`).
        - `description`: A clear, concise explanation of what the tool does. This is shown to the MCP host/LLM.
        - `zodSchemaShape`: The Zod schema object defining the expected input arguments for your tool. The SDK uses this to generate the JSON Schema for the MCP host and to validate incoming arguments.
        - `handler`: An asynchronous function that contains your tool's core logic. It receives the validated arguments. It **MUST** return a `CallToolResult` object: `{ content: [...], isError: boolean }`.
        - **Annotations**: Remember to add relevant annotations (e.g., `readOnlyHint`, `destructiveHint`, `confirmationRequired`) as untrusted hints within the tool's metadata if applicable. These help the LLM understand the implications of using the tool.
      - **For Resources**: Use `server.resource(registrationName, template, metadata, async handler => { ... })`.
        - `registrationName`: A unique name for this resource registration.
        - `template`: A `ResourceTemplate` object defining the URI pattern and any parameters.
        - `metadata`: Additional metadata for the resource.
        - `handler`: An asynchronous function that fetches/generates the resource content. It receives the URI and parsed parameters. It **MUST** return an object like `{ contents: [{ uri, blob, mimeType }] }`, where `blob` is the Base64 encoded content.
        - If your resource supports subscriptions (`subscribe: true` in capabilities), you **MUST** also handle the `resources/unsubscribe` request appropriately.
    - **Error Handling**: Wrap your handler logic and the registration call itself in `ErrorHandler.tryCatch(...)` to ensure robust error management and consistent logging.

4.  **Export & Integrate (`index.ts` and `server.ts`)**:
    - Create an `index.ts` file in your new directory that exports your registration function.
    - Import and call your registration function within the `createMcpServerInstance` function in `src/mcp-server/server.ts`. This makes your new tool/resource part of the server when it initializes.

### ✨ Example References

- **EchoTool**: See `src/mcp-server/tools/echoTool/` for a basic example of a synchronous tool.
- **EchoResource**: See `src/mcp-server/resources/echoResource/` for a basic resource example.
- **CatFactFetcher Tool**: For an example of a tool that performs asynchronous operations (like an external API call), refer to `src/mcp-server/tools/catFactFetcher/`. This demonstrates `async/await` usage, Promise management, and integration of external data sources within a tool's handler.
- **ImageTest Tool**: See `src/mcp-server/tools/imageTest/` for an example of a tool that returns an image blob.

### 🚀 Server Initialization and Transports

The main server logic in `src/mcp-server/server.ts` handles the creation of the `McpServer` instance. This instance is then connected to a transport layer:

- **Stdio Transport (`src/mcp-server/transports/stdioTransport.ts`)**: Used for direct communication when the server is a child process. It leverages `StdioServerTransport` from the SDK.
- **Streamable HTTP Transport (`src/mcp-server/transports/httpTransport.ts`)**: Provides an HTTP interface using Hono and Server-Sent Events (SSE) for streaming, managed by `StreamableHTTPServerTransport` from the SDK. This transport handles session management, authentication (via `authMiddleware.ts`), and CORS.

When you register your tools and resources in `createMcpServerInstance`, they become available regardless of the chosen transport, as the core `McpServer` instance handles the protocol logic.

### 💡 Best Practices

- **Clear Schemas**: Define precise Zod schemas for your tool inputs. This is key for reliable interaction with the MCP host and LLM.
- **Descriptive Naming**: Use clear names and descriptions for your tools and resources.
- **Idempotency**: Design tools to be idempotent where possible.
- **Comprehensive Error Handling**: Utilize the `ErrorHandler` to catch and log errors effectively, providing useful feedback to the client.
- **Security**: Sanitize any inputs, especially if they are used in file paths, database queries, or external API calls. Refer to `src/utils/security/sanitization.ts`.
- **Contextual Logging**: Use the `logger` utility with appropriate `RequestContext` to provide traceable logs.

By following these patterns, you can effectively extend the MCP server with new capabilities while maintaining a robust and well-structured codebase. For more detailed patterns and advanced examples, refer to the [.clinerules](../../../.clinerules) developer cheatsheet.
