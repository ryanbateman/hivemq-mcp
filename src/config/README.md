# Config System: Configuration Made Easy 🔧

This directory contains the configuration management system for your application. It provides a flexible, secure way to configure your app using environment variables and configuration files.

## What's Inside

- **[Environment Config](#environment-config)** - Load settings from environment variables
- **[MCP Servers Config](#mcp-servers-config)** - Configure MCP server connections
- **[Config Index](#config-index)** - Unified configuration access

## Quick Start

Import and use the configuration system:

```typescript
// Get the complete configuration
import { config } from './config/index.js';

// Use async/await to access config
const appConfig = await config();
console.log(`Running in ${appConfig.environment} mode`);

// Or use specific helper functions
import { getEnvironment, getLogLevel } from './config/index.js';
console.log(`Log level: ${getLogLevel()}`);
```

## Environment Config

`envConfig.ts` handles loading settings from environment variables with validation and default values.

```typescript
import { envConfig, getLogLevel, getRateLimit } from './config/envConfig.js';

// Get complete environment config
const env = envConfig();
console.log(`Environment: ${env.environment}`);

// Use helper functions for specific values
const logLevel = getLogLevel();
const rateLimit = getRateLimit();
```

### Supported Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Application environment | "development" |
| `LOG_LEVEL` | Logging level | "info" |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in ms | 60000 (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 |

## MCP Servers Config

`mcpConfig.ts` loads and validates MCP server configurations from a JSON file.

> **Note:** The MCP servers configuration is not currently implemented in the main startup process. This functionality is intended for future implementation of mcp-client.

```typescript
import { 
  enabledMcpServers, 
  getMcpConfig 
} from './config/mcpConfig.js';

// Get all server configurations
const allServers = await getMcpConfig();

// Get only enabled servers
const servers = await enabledMcpServers();
```

### MCP Server Configuration Format

```json
{
  "mcpServers": {
    "weather-server": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "API_KEY": "your-api-key"
      },
      "disabled": false,
      "alwaysAllow": ["getWeather"]
    }
  }
}
```

This configuration format will be used in future mcp-client implementation but is not currently active in the main application startup process.

Each server configuration includes:
- `command`: The command to run the server
- `args`: Command line arguments
- `env`: Environment variables for the server (optional)
- `disabled`: Whether the server is disabled (optional)
- `alwaysAllow`: Array of tool names that don't require user confirmation (optional)

## Config Index

`index.ts` provides a unified configuration object that combines all config sources.

```typescript
import { config } from './config/index.js';

// Get the complete configuration
const appConfig = await config();

// Access various configuration parts
console.log(`Server name: ${appConfig.mcpServerName}`);
console.log(`Environment: ${appConfig.environment}`);
console.log(`MCP Servers: ${Object.keys(appConfig.mcpServers).join(', ')}`);
```

## Features

### 🔒 Secure Configuration

All configuration inputs are sanitized and validated to prevent security issues:

- Environment variables are validated and bound-checked
- Configuration files have size limits to prevent DoS attacks
- File paths are sanitized to prevent path traversal

### ⚡ Lazy Loading

The configuration system uses lazy loading with caching for efficiency:

- Configuration is only loaded when actually needed
- Subsequent requests use cached values
- Package info is loaded only once

### 🛡️ Error Handling

The configuration system includes comprehensive error handling:

- Invalid configurations produce meaningful error messages
- Non-critical errors return safe defaults
- Critical errors are propagated for application-level handling

## Tips and Best Practices

- Use environment variables for deployment-specific settings (like log levels)
- Use configuration files for more complex settings (like MCP servers)
- Add proper validation for any new configuration values
- Follow the lazy-loading pattern for new configuration modules