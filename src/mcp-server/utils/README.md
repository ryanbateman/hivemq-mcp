# MCP Server Utils: Registration Helpers 🔌

This directory contains utilities specifically designed for the MCP server implementation, making it easier to register tools and resources with consistent patterns.

## What's Inside

- **[Registration Helper](#registration-helper)** - Simplify tool and resource registration

## Quick Start

```typescript
import { registerTool, registerResource } from './mcp-server/utils/registrationHelper.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Initialize your MCP server
const server = new McpServer({ /* config */ });

// Register a tool with clean error handling
await registerTool(
  server,
  { name: 'calculateSum' },
  async (server, logger) => {
    // Tool registration logic here
    logger.info('Setting up calculateSum tool');
    
    // Your registration code
    server.tool('calculateSum', { /* schema */ }, handleCalculateSum);
  }
);

// Register a resource with consistent logging
await registerResource(
  server,
  { name: 'weatherData', loggerContext: { source: 'OpenWeather' } },
  async (server, logger) => {
    // Resource registration logic here
    logger.info('Setting up weatherData resource');
    
    // Your registration code
    server.resource('weather://current', handleWeatherRequest);
  }
);
```

## Registration Helper

The registration helper provides a consistent pattern for registering MCP server components (tools and resources) with proper error handling and logging.

### Key Features

- ✅ Consistent error handling for all registrations
- ✅ Detailed logging with component-specific loggers
- ✅ Clean registration patterns for both tools and resources
- ✅ Standardized error messages and context

### API Reference

#### `registerTool`

Register a tool with the MCP server using a consistent pattern.

```typescript
async function registerTool(
  server: McpServer,
  options: RegistrationOptions,
  handlerFn: (server: McpServer, logger: ChildLogger) => Promise<void>
): Promise<void>
```

Parameters:
- `server`: MCP server instance
- `options`: Registration options
  - `name`: Name of the tool
  - `loggerContext`: (Optional) Additional context for the logger
- `handlerFn`: Function that performs the actual registration

#### `registerResource`

Register a resource with the MCP server using a consistent pattern.

```typescript
async function registerResource(
  server: McpServer,
  options: RegistrationOptions,
  handlerFn: (server: McpServer, logger: ChildLogger) => Promise<void>
): Promise<void>
```

Parameters:
- `server`: MCP server instance
- `options`: Registration options
  - `name`: Name of the resource
  - `loggerContext`: (Optional) Additional context for the logger
- `handlerFn`: Function that performs the actual registration

#### `registerComponent` (Internal)

Base helper that both `registerTool` and `registerResource` use internally.

```typescript
async function registerComponent(
  server: McpServer,
  options: InternalRegistrationOptions,
  registerFn: (server: McpServer, childLogger: ChildLogger) => Promise<void>
): Promise<void>
```

## How to Use

### Registering a Tool

```typescript
import { registerTool } from './mcp-server/utils/registrationHelper.js';

// In your tool setup file
export async function setupCalculatorTool(server) {
  await registerTool(
    server,
    { name: 'calculator' },
    async (server, logger) => {
      logger.info('Setting up calculator operations');
      
      // Register the tool
      server.tool(
        'add', 
        { 
          a: z.number(), 
          b: z.number() 
        }, 
        handleAddOperation
      );
      
      logger.debug('Calculator add operation registered');
    }
  );
}
```

### Registering a Resource

```typescript
import { registerResource } from './mcp-server/utils/registrationHelper.js';

// In your resource setup file
export async function setupDataResource(server) {
  await registerResource(
    server,
    { 
      name: 'dataResource',
      loggerContext: { dataType: 'external' }
    },
    async (server, logger) => {
      logger.info('Setting up data resource endpoints');
      
      // Register the resource
      server.resource(
        'data://stats', 
        handleStatsRequest
      );
      
      logger.debug('Data stats resource registered');
    }
  );
}
```

## Best Practices

- Always use the registration helpers rather than directly registering tools/resources
- Provide meaningful names in the registration options
- Add relevant context in the `loggerContext` for better debugging
- Keep the handler functions focused on registration logic
- Use the provided logger instead of creating your own