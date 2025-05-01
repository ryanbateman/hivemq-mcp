# MCP TypeScript Template

[![TypeScript](https://img.shields.io/badge/TypeScript-^5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-1.10.2-green.svg)](https://modelcontextprotocol.io/)
[![Version](https://img.shields.io/badge/Version-1.0.6-blue.svg)](./CHANGELOG.md) <!-- Link to Changelog -->
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status](https://img.shields.io/badge/Status-Stable-green.svg)](https://github.com/cyanheads/mcp-ts-template/issues)
[![GitHub](https://img.shields.io/github/stars/cyanheads/mcp-ts-template?style=social)](https://github.com/cyanheads/mcp-ts-template)

A beginner-friendly foundation for building [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers and clients with TypeScript. This template provides a comprehensive starting point with production-ready utilities, well-structured code, and working examples for both server and client implementations.

Copy this repo to kickstart your own MCP server or integrate MCP client capabilities into your application!

**This template provides:**

- **🚀 Production-Ready Utilities**: Logging, error handling, ID generation, rate limiting, request context, sanitization.
- **🔒 Type Safety & Security**: TypeScript for compile-time checks and built-in security utilities.
- **⚙️ Robust Error Handling & Logging**: Consistent error categorization and logging.
- **📚 Clear Documentation**: Guidance on usage, configuration, and extension.
- **✨ MCP Server**: Includes an [Echo Tool](src/mcp-server/tools/echoTool/) and [Echo Resource](src/mcp-server/resources/echoResource/) implementation.
- **🔌 MCP Client**: A functional client ([src/mcp-client/](src/mcp-client/)) to connect to other MCP servers. Configuration via `mcp-config.json`.

> **🤖 Agent Ready**: Includes a [.clinerules](.clinerules) file – a developer cheat sheet for your LLM coding agent with quick references for codebase patterns, file locations, and code snippets. Remember to update it when you customize the template!

## 📋 Table of Contents

[Overview](#overview) | [Explore More MCP Resources](#explore-more-mcp-resources) | [Features](#features) | [Installation](#installation) | [Configuration](#configuration) | [Project Structure](#project-structure) | [Development Guidelines](#development-guidelines) | [License](#license)

## Overview

### What is Model Context Protocol?

Model Context Protocol (MCP) is a framework that enables AI systems to interact with external tools and resources. It allows language models to:

- Execute **tools** that perform actions and return results
- Access structured **resources** that provide information
- Create contextual workflows through standardized interfaces

This template gives you a head start in building MCP servers that can be used by AI systems to extend their capabilities, and provides a client implementation for connecting to other MCP servers.

## Features

This template includes a range of features designed for building robust and maintainable MCP applications:

| Category             | Feature                         | Description                                                                                                | Location(s)                                     |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Core Components**  | MCP Server                      | Core server logic, tool/resource registration, transport handling. Includes Echo Tool & Resource examples. | `src/mcp-server/`                               |
|                      | MCP Client                      | Logic for connecting to external MCP servers defined in `mcp-config.json`.                                 | `src/mcp-client/`                               |
|                      | Configuration                   | Environment-aware settings with Zod validation.                                                            | `src/config/`, `src/mcp-client/configLoader.ts` |
|                      | HTTP Transport                  | Express-based server with SSE, session management, CORS, port retries.                                     | `src/mcp-server/transports/httpTransport.ts`    |
|                      | Stdio Transport                 | Handles MCP communication over standard input/output.                                                      | `src/mcp-server/transports/stdioTransport.ts`   |
| **Utilities (Core)** | Logger                          | Structured, context-aware logging (files & MCP notifications).                                             | `src/utils/internal/logger.ts`                  |
|                      | ErrorHandler                    | Centralized error processing, classification, and logging.                                                 | `src/utils/internal/errorHandler.ts`            |
|                      | RequestContext                  | Request/operation tracking and correlation.                                                                | `src/utils/internal/requestContext.ts`          |
| **Utilities (Metrics)**| TokenCounter                    | Estimates token counts using `tiktoken`.                                                                   | `src/utils/metrics/tokenCounter.ts`             |
| **Utilities (Parsing)**| DateParser                      | Parses natural language date strings using `chrono-node`.                                                  | `src/utils/parsing/dateParser.ts`               |
|                      | JsonParser                      | Parses potentially partial JSON, handles `<think>` blocks.                                                 | `src/utils/parsing/jsonParser.ts`               |
| **Utilities (Security)**| IdGenerator                     | Generates unique IDs (prefixed or UUIDs).                                                                  | `src/utils/security/idGenerator.ts`             |
|                      | RateLimiter                     | Request throttling based on keys.                                                                          | `src/utils/security/rateLimiter.ts`             |
|                      | Sanitization                    | Input validation/cleaning (HTML, paths, URLs, numbers, JSON) & log redaction (`validator`, `sanitize-html`). | `src/utils/security/sanitization.ts`            |
| **Type Safety**      | Global Types                    | Shared TypeScript definitions for consistent interfaces (Errors, MCP, Tools).                              | `src/types-global/`                             |
|                      | Zod Schemas                     | Used for robust validation of configuration files and tool/resource inputs.                                | Throughout (`config`, `mcp-client`, tools, etc.) |
| **Error Handling**   | Pattern-Based Classification    | Automatically categorize errors based on message patterns.                                                 | `src/utils/internal/errorHandler.ts`            |
|                      | Consistent Formatting           | Standardized error responses with additional context.                                                      | `src/utils/internal/errorHandler.ts`            |
|                      | Safe Try/Catch Patterns         | Centralized error processing helpers (`ErrorHandler.tryCatch`).                                            | `src/utils/internal/errorHandler.ts`            |
|                      | Client/Transport Error Handling | Specific handlers for MCP client and transport errors.                                                     | `src/mcp-client/client.ts`, `transport.ts`      |
| **Security**         | Input Validation                | Using `validator` and `zod` for various data type checks.                                                  | `src/utils/security/sanitization.ts`, etc.      |
|                      | Input Sanitization              | Using `sanitize-html` to prevent injection attacks.                                                        | `src/utils/security/sanitization.ts`            |
|                      | Sensitive Data Redaction        | Automatic redaction in logs.                                                                               | `src/utils/security/sanitization.ts`            |
|                      | Configuration Fallback          | Safely falls back to `mcp-config.json.example` if primary client config is missing.                        | `src/mcp-client/configLoader.ts`                |

## Installation

### Prerequisites

- [Node.js (v18+)](https://nodejs.org/)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Setup

1. Clone this repository:

   ```bash
   git clone https://github.com/cyanheads/mcp-ts-template.git
   cd mcp-ts-template
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the project:

   ```bash
   npm run build
   ```

### Running the Example Server

Once built, you can run the included MCP server (which provides the Echo tool and Echo Resource) using the following npm scripts:

- **Using Standard I/O (Default):**

  ```bash
  npm start
  # or explicitly:
  npm run start:stdio
  ```

  The server will listen for MCP messages on stdin/stdout.

- **Using HTTP:**
  ```bash
  npm run start:http
  ```
  This uses the `MCP_TRANSPORT_TYPE=http` environment variable implicitly. The server will start an HTTP server (default: `http://127.0.0.1:3000`). You can configure the port, host, and allowed origins using environment variables (see below).

## Configuration

Configuration is managed through environment variables (for the server) and a JSON file (for the client).

### Server Environment Variables

#### Environment Variables

The **server** behavior can be configured using the following environment variables:

| Variable               | Description                                                                                                   | Default             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| `MCP_TRANSPORT_TYPE`   | Specifies the transport mechanism for the **server**. Options: `stdio`, `http`.                               | `stdio`             |
| `MCP_HTTP_PORT`        | The port number for the HTTP **server** to listen on.                                                         | `3000`              |
| `MCP_HTTP_HOST`        | The host address for the HTTP **server** to bind to.                                                          | `127.0.0.1`         |
| `MCP_ALLOWED_ORIGINS`  | Comma-separated list of allowed origins for CORS requests when using the `http` transport for the **server**. | (none)              |
| `MCP_SERVER_NAME`      | Name of the MCP **server** (used in initialization).                                                          | `mcp-ts-template`   |
| `MCP_SERVER_VERSION`   | Version of the MCP **server** (used in initialization).                                                       | (from package.json) |
| `LOG_LEVEL`            | Logging level (e.g., `info`, `debug`, `warn`, `error`). Applies to both server and client logs.               | `info`              |
| `LOG_REDACT_PATTERNS`  | Comma-separated list of regex patterns for redacting sensitive data in logs.                                  | (predefined)        |
| `LOG_FILE_PATH`        | Path to the log file. If not set, logs only to console.                                                       | (none)              |
| `LOG_MAX_FILE_SIZE_MB` | Maximum size of a single log file before rotation (in MB).                                                    | `10`                |
| `LOG_MAX_FILES`        | Maximum number of rotated log files to keep.                                                                  | `5`                 |
| `LOG_ZIP_ARCHIVES`     | Whether to compress rotated log files (`true`/`false`).                                                       | `true`              |

**Note on HTTP Port Retries:** If the specified `MCP_HTTP_PORT` is in use, the server will attempt to bind to the next available port, retrying up to 15 times (e.g., if 3000 is busy, it tries 3001, 3002, ..., up to 3015).

### Client Connections (`mcp-config.json`)

The **client** connections are configured via the `src/mcp-client/mcp-config.json` file. If this file doesn't exist, the template will fall back to `src/mcp-client/mcp-config.json.example`.

This JSON file defines the MCP servers the client can connect to. Each server entry requires:

- **`command`**:
  - For `stdio` transport: The command to execute the server (e.g., `node`).
  - For `http` transport: The base URL of the server (e.g., `http://localhost:3001`).
- **`args`**: (Required for `stdio`) An array of arguments to pass to the command.
- **`env`**: (Optional) An object of environment variables to set for the server process (primarily for `stdio`). These override any existing environment variables.
- **`transportType`**: (Optional) Specifies the transport mechanism. Options: `stdio`, `http`. Defaults to `stdio`.

**Example `mcp-config.json` entry:**

```json
{
  "mcpServers": {
    "my-stdio-server": {
      "command": "node",
      "args": ["/path/to/my-server/index.js"],
      "env": {
        "LOG_LEVEL": "debug"
      },
      "transportType": "stdio"
    },
    "my-http-server": {
      "command": "http://localhost:8080", // Base URL for HTTP
      "args": [], // Not typically used for HTTP
      "transportType": "http"
    }
    // ... other server definitions
  }
}
```

See `src/mcp-client/configLoader.ts` for the Zod schema defining the exact structure and validation rules.

## Project Structure

The codebase follows a modular structure within the `src/` directory:

- `config/`: General configuration loading (primarily environment variables).
- `mcp-client/`: Logic for connecting to external MCP servers.
  - `client.ts`: Core client connection and management logic.
  - `configLoader.ts`: Loads and validates `mcp-config.json`.
  - `transport.ts`: Creates `stdio` or `http` transports based on config.
  - `mcp-config.json.example`: Example configuration file for client connections - copy to `mcp-config.json` to use.
- `mcp-server/`: Logic for the MCP server provided by this template.
  - `server.ts`: Server initialization and registration of tools/resources.
  - `resources/`: Resource implementations.
  - `tools/`: Tool implementations.
- `types-global/`: TypeScript definitions shared across the project.
- `utils/`: Common utility functions, organized into subdirectories (`internal`, `metrics`, `parsing`, `security`) and exported via `index.ts`.

For a detailed, up-to-date view of the project structure, run the following command:

```bash
npm run tree
```

This command executes the `scripts/tree.ts` script, which generates a tree representation of the current project layout.

## Development Guidelines

_(These guidelines apply to extending **this template's server**)_

### Adding a New Tool

1.  **Create Directory**: Create a new directory for your tool under `src/mcp-server/tools/` (e.g., `src/mcp-server/tools/myNewTool/`).
2.  **Define Logic & Schema**: In a `myNewToolLogic.ts` file:
    - Define the input validation schema using **Zod**. This schema serves as the single source of truth for input structure and types.
    - Use `z.infer<typeof YourZodSchema>` to automatically derive the TypeScript input type from the Zod schema.
    - Define a TypeScript interface for the tool's output.
    - Implement the core logic function that takes the validated input (typed using the inferred type) and returns the output.
3.  **Implement Registration**: In a `registration.ts` file:
    - Import necessary types, the Zod schema, the logic function, `McpServer`, `ErrorHandler`, and `logger`.
    - Create an `async` function (e.g., `registerMyNewTool`) that accepts the `McpServer` instance.
    - Inside this function, use `ErrorHandler.tryCatch` to wrap the `server.tool()` call.
    - Call `server.tool()` using the 4-argument overload (available in SDK v1.10.2+):
      - The tool name (string).
      - The tool description (string).
      - The **shape** of the Zod input schema (e.g., `MyToolInputSchema.shape`). The SDK uses this for validation.
      - An `async` handler function that:
        - Takes the validated `params` (which will match the inferred TypeScript type).
        - Uses `ErrorHandler.tryCatch` to wrap the call to your core logic function.
        - Formats the result according to the MCP specification (e.g., `{ content: [{ type: "text", text: JSON.stringify(result) }] }`).
        - Includes appropriate logging.
4.  **Export Registration**: In an `index.ts` file within your tool's directory, export the registration function (e.g., `export { registerMyNewTool } from './registration.js';`).
5.  **Register in Server**: In `src/mcp-server/server.ts`, import your registration function and call it, passing the `server` instance (e.g., `await registerMyNewTool(server);`).

```typescript
// In src/mcp-server/server.ts:
// import { registerMyNewTool } from './tools/myNewTool/index.js';
// ...
// await registerMyNewTool(server);
```

### Adding a New Resource

1.  **Create Directory**: Create a new directory for your resource under `src/mcp-server/resources/` (e.g., `src/mcp-server/resources/myNewResource/`).
2.  **Define Logic & Schema**: In a `myNewResourceLogic.ts` file:
    - Define a **Zod** schema for any expected query parameters.
    - Use `z.infer<typeof YourQuerySchema>` to derive the TypeScript type for query parameters.
    - Define TypeScript interfaces for path parameters if needed (extracted from the URI path).
    - Implement the core logic function that takes the `uri` (URL object) and validated `params` (query parameters) and returns the resource data.
3.  **Implement Registration**: In a `registration.ts` file:
    - Import necessary types, the Zod query schema, the logic function, `McpServer`, `ResourceTemplate`, `ErrorHandler`, and `logger`.
    - Create an `async` function (e.g., `registerMyNewResource`) that accepts the `McpServer` instance.
    - Inside this function, use `ErrorHandler.tryCatch` to wrap the registration process.
    - Define a `ResourceTemplate` with the URI pattern and any `list` or `complete` operations.
    - Call `server.resource()` with:
      - A unique resource registration name (string).
      - The `ResourceTemplate` instance.
      - Resource metadata (name, description, mimeType, querySchema (the Zod schema itself), examples).
      - An `async` handler function that:
        - Takes the `uri` (URL) and validated `params` (query parameters matching the inferred type).
        - Uses `ErrorHandler.tryCatch` to wrap the call to your core logic function.
        - Formats the result according to the MCP specification (e.g., `{ contents: [{ uri: uri.href, text: JSON.stringify(result), mimeType: "application/json" }] }`).
        - Includes appropriate logging.
4.  **Export Registration**: In an `index.ts` file within your resource's directory, export the registration function (e.g., `export { registerMyNewResource } from './registration.js';`).
5.  **Register in Server**: In `src/mcp-server/server.ts`, import your registration function and call it, passing the `server` instance (e.g., `await registerMyNewResource(server);`).

Example `registration.ts` structure

```typescript
// In src/mcp-server/server.ts:
// import { registerMyNewResource } from './resources/myNewResource/index.js';
// ...
// await registerMyNewResource(server);
```

## Explore More MCP Resources

For a broader collection of MCP guides, utilities, and diverse server implementations (including Perplexity, Atlas, Filesystem, Obsidian, Git, GitHub, Ntfy, and more), check out the companion repository:

➡️ **[cyanheads/model-context-protocol-resources](https://github.com/cyanheads/model-context-protocol-resources)**

This repository complements the template by providing in-depth guides and helpful resources based on my real-world usage and learning of MCP.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Built with the <a href="https://modelcontextprotocol.io/">Model Context Protocol</a>
</div>
