# MCP HiveMQ prototype


A simple prototype of an [Model Context Protocol (MCP) Server](https://modelcontextprotocol.io/) for HiveMQ's MQTT Broker, based on a [Typescript template project](https://github.com/cyanheads/mcp-ts-template).

## 🏁 Quick Start

Get the example server running in minutes:

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/ryanbateman/hivemq-mcp#
    cd hivemq-mcp
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Build the project:**

    ```bash
    npm run build
    # Or use 'npm run rebuild' for a clean install (deletes node_modules, logs, dist)
    ```

4.  **Format the code (Optional but Recommended):**

    ```bash
    npm run format
    ```

5.  **Run the Server:**

    - **as an integraiton with Claude Desktop:**  
    Add it as a configured MCP server using Claude Desktop's settings.
      ```json
      "hive_mcp":
        {
            "command": "node",
            "args":
            [
                "~/Documents/workspace/hivemq-mcp/dist/index.js"
            ],
            "env":
            {
                "LOG_LEVEL": "debug"
            }
        },
      ```
    - **Via Stdio (Default):** Many MCP host applications will run this automatically using `stdio`. To run manually for testing:
      ```bash
      npm start
      # or 'npm run start:stdio'
      ```
    - **Via Streamable HTTP:**
      ```bash
      npm run start:http
      ```
      This starts a **Streamable HTTP** server (default: `http://127.0.0.1:3010`) which uses Server-Sent Events for the server-to-client streaming component. The port, host, and allowed origins are configurable via environment variables (see [Configuration](#configuration)).

## ⚙️ Configuration

### 🔩 Server Configuration (Environment Variables)

Configure the MCP server's behavior using these environment variables:

| Variable                  | Description                                                                                         | Default                                 |
| :------------------------ | :-------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| `MCP_TRANSPORT_TYPE`      | Server transport: `stdio` or `http`.                                                                | `stdio`                                 |
| `MCP_HTTP_PORT`           | Port for the HTTP server (if `MCP_TRANSPORT_TYPE=http`).                                            | `3010`                                  |
| `MCP_HTTP_HOST`           | Host address for the HTTP server (if `MCP_TRANSPORT_TYPE=http`).                                    | `127.0.0.1`                             |
| `MCP_ALLOWED_ORIGINS`     | Comma-separated allowed origins for CORS (if `MCP_TRANSPORT_TYPE=http`).                            | (none)                                  |
| `MCP_SERVER_NAME`         | Optional server name (used in MCP initialization).                                                  | (from package.json)                     |
| `MCP_SERVER_VERSION`      | Optional server version (used in MCP initialization).                                               | (from package.json)                     |
| `MCP_LOG_LEVEL`           | Server logging level (`debug`, `info`, `warning`, `error`, etc.).                                   | `debug`                                 |
| `LOGS_DIR`                | Directory for log files.                                                                            | `logs/` (in project root)               |
| `NODE_ENV`                | Runtime environment (`development`, `production`).                                                  | `development`                           |
| `MCP_AUTH_SECRET_KEY`     | **Required for HTTP transport.** Secret key (min 32 chars) for signing/verifying auth tokens (JWT). | (none - **MUST be set in production**)  |
| `OPENROUTER_API_KEY`      | API key for OpenRouter.ai service. Optional, but service will be unconfigured without it.           | (none)                                  |
| `LLM_DEFAULT_MODEL`       | Default model to use for LLM calls via OpenRouter.                                                  | `google/gemini-2.5-flash-preview-05-20` |
| `LLM_DEFAULT_TEMPERATURE` | Default temperature for LLM calls (0-2). Optional.                                                  | (none)                                  |

**Note on HTTP Port Retries:** If the `MCP_HTTP_PORT` is busy, the server automatically tries the next port (up to 15 times).

**Security Note for HTTP Transport:** When using `MCP_TRANSPORT_TYPE=http`, authentication is **mandatory** as per the MCP specification. This template includes JWT-based authentication middleware (`src/mcp-server/transports/authentication/authMiddleware.ts`). You **MUST** set a strong, unique `MCP_AUTH_SECRET_KEY` in your production environment for this security mechanism to function correctly. Failure to do so will result in bypassed authentication checks in development and fatal errors in production.
