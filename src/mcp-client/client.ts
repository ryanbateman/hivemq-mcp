import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js"; // Import ClientCapabilities type
import { BaseErrorCode, McpError } from "../types-global/errors.js";
import { ErrorHandler } from "../utils/errorHandler.js";
import { logger } from "../utils/logger.js";
import { RequestContext, requestContextService } from "../utils/requestContext.js";
import { getClientTransport } from "./transport.js";
// Import config loader for early validation
import { getMcpServerConfig } from "./configLoader.js";

// Define a type for the connected client instance
export type ConnectedMcpClient = Client; // Alias for clarity

// Store connected clients (optional, could manage connections externally)
const connectedClients: Map<string, ConnectedMcpClient> = new Map();

/**
 * Creates, connects, and returns an MCP client instance for a specified server.
 * If a client for the server is already connected, it returns the existing instance.
 * Validates server configuration before attempting connection.
 *
 * @param serverName - The name of the MCP server to connect to (must exist in mcp-config.json).
 * @param parentContext - Optional parent request context for logging.
 * @returns A promise resolving to the connected Client instance.
 * @throws McpError if configuration is missing, transport fails, or connection fails.
 */
export async function connectMcpClient(
  serverName: string,
  parentContext?: RequestContext | null
): Promise<ConnectedMcpClient> {
  const operationContext = requestContextService.createRequestContext({
    ...(parentContext ?? {}),
    operation: 'connectMcpClient',
    targetServer: serverName,
  });

  // Check if client is already connected
  if (connectedClients.has(serverName)) {
    logger.debug(`Returning existing connected client for server: ${serverName}`, operationContext);
    return connectedClients.get(serverName)!;
  }

  logger.info(`Attempting to connect to MCP server: ${serverName}`, operationContext);

  return await ErrorHandler.tryCatch(
    async () => {
      // 1. Validate server configuration exists *before* getting transport
      // This call will throw McpError if the serverName is not found in the config.
      logger.debug(`Validating configuration for server: ${serverName}`, operationContext);
      getMcpServerConfig(serverName, operationContext); // Throws if not found
      logger.debug(`Configuration validated for server: ${serverName}`, operationContext);

      // 2. Define Client Identity & Full Capabilities (as per 2025-03-26 spec)
      // TODO: Load client identity from config later if needed
      const clientIdentity = { name: `mcp-ts-template-client-for-${serverName}`, version: '1.0.0' };

      // Declare full client capabilities structure
      const clientCapabilities: ClientCapabilities = {
        // Resources: Declare support for listing, reading, and potentially subscriptions/list changes
        resources: {
          list: true, // Can list resources
          read: true, // Can read resource content
          templates: { list: true }, // Can list resource templates
          // subscribe: true, // Uncomment if client supports subscribing to resource updates
          // listChanged: true, // Uncomment if client handles resource list change notifications
        },
        // Tools: Declare support for listing and calling tools
        tools: {
          list: true, // Can list tools
          call: true, // Can call tools
          // listChanged: true, // Uncomment if client handles tool list change notifications
        },
        // Prompts: Declare support for listing and getting prompts
        prompts: {
          list: true, // Can list prompts
          get: true, // Can get prompt content
          // listChanged: true, // Uncomment if client handles prompt list change notifications
        },
        // Logging: Declare support for receiving log messages and setting levels
        logging: {
          setLevel: true, // Can set the server's log level
        },
        // Roots: Declare support for handling filesystem roots
        roots: {
          listChanged: true, // Can handle notifications when roots change
        },
        // Add other capabilities like 'sampling', 'completions', 'configuration' if supported
        // sampling: { createMessage: true },
        // completions: { complete: true },
        // configuration: { get: true, set: true },
      };
      logger.debug("Client capabilities defined", { ...operationContext, capabilities: clientCapabilities });


      // 3. Get the specific transport for the target server
      // This now happens *after* config validation
      const transport = getClientTransport(serverName, operationContext);

      // 4. Create the Client instance using the high-level SDK constructor
      logger.debug(`Creating MCP Client instance for ${serverName}`, operationContext);
      const client = new Client(clientIdentity, { capabilities: clientCapabilities });

      // 5. Setup error handling for the client/transport
      client.onerror = (clientError: Error) => {
        const errorCode = (clientError as any).code;
        const errorData = (clientError as any).data;
        logger.error(`MCP Client error for server ${serverName}`, {
          ...operationContext,
          error: clientError.message,
          code: errorCode,
          data: errorData,
          stack: clientError.stack,
        });
        disconnectMcpClient(serverName, operationContext, clientError);
      };
      transport.onerror = (transportError: Error) => {
         logger.error(`MCP Transport error for server ${serverName}`, {
           ...operationContext,
           error: transportError.message,
           stack: transportError.stack,
         });
         disconnectMcpClient(serverName, operationContext, transportError);
      };
       transport.onclose = () => {
         logger.info(`MCP Transport closed for server ${serverName}`, operationContext);
         disconnectMcpClient(serverName, operationContext);
       };


      // 6. Connect the client to the transport
      logger.info(`Connecting client to transport for ${serverName}...`, operationContext);
      await client.connect(transport);
      logger.info(`Successfully connected to MCP server: ${serverName}`, operationContext);

      // Store the connected client
      connectedClients.set(serverName, client);

      return client;
    },
    {
      operation: `connecting to MCP server ${serverName}`,
      context: operationContext,
      errorCode: BaseErrorCode.INTERNAL_ERROR, // Default, specific errors thrown by getMcpServerConfig or connect
      rethrow: true,
    }
  );
}

/**
 * Disconnects a specific MCP client and removes it from the cache.
 *
 * @param serverName - The name of the server whose client should be disconnected.
 * @param parentContext - Optional parent request context for logging.
 * @param error - Optional error that triggered the disconnect.
 */
export async function disconnectMcpClient(
    serverName: string,
    parentContext?: RequestContext | null,
    error?: Error | McpError
): Promise<void> {
    const context = requestContextService.createRequestContext({
        ...(parentContext ?? {}),
        operation: 'disconnectMcpClient',
        targetServer: serverName,
        triggerReason: error ? error.message : 'explicit disconnect or close',
    });

    const client = connectedClients.get(serverName);

    if (client) {
        logger.info(`Disconnecting client for server: ${serverName}`, context);
        try {
            await client.close(); // Attempt graceful close
            logger.info(`Client for ${serverName} closed successfully.`, context);
        } catch (closeError) {
            logger.error(`Error closing client for ${serverName}`, {
                ...context,
                error: closeError instanceof Error ? closeError.message : String(closeError),
                stack: closeError instanceof Error ? closeError.stack : undefined,
            });
            // Continue cleanup even if close fails
        } finally {
            connectedClients.delete(serverName); // Remove from cache regardless of close success/failure
            logger.debug(`Removed client ${serverName} from connection cache.`, context);
         }
     } else {
        // Only log warning if it wasn't triggered by an error (to avoid duplicate logs on error disconnect)
        if (!error) {
            logger.warning(`Client for server ${serverName} not found in cache or already disconnected.`, context);
        }
        // Ensure it's removed if somehow still present but not retrieved correctly
        if (connectedClients.has(serverName)) {
             connectedClients.delete(serverName);
        }
    }
}

/**
 * Disconnects all currently connected MCP clients.
 * Useful for application shutdown.
 *
 * @param parentContext - Optional parent request context for logging.
 */
export async function disconnectAllMcpClients(parentContext?: RequestContext | null): Promise<void> {
    const context = requestContextService.createRequestContext({
        ...(parentContext ?? {}),
        operation: 'disconnectAllMcpClients',
    });
    logger.info("Disconnecting all MCP clients...", context);
    const disconnectionPromises: Promise<void>[] = [];
    // Create a copy of keys to avoid issues while iterating and deleting
    const serverNames = Array.from(connectedClients.keys());
    for (const serverName of serverNames) {
        disconnectionPromises.push(disconnectMcpClient(serverName, context));
    }
    try {
        await Promise.all(disconnectionPromises);
        logger.info("All MCP clients disconnected.", context);
    } catch (error) {
        logger.error("Error during disconnection of all clients", {
            ...context,
            error: error instanceof Error ? error.message : String(error),
        });
        // Decide if this should throw or just log
    }
}

// Optional: Graceful shutdown integration
// process.on('SIGINT', () => disconnectAllMcpClients().then(() => process.exit(0)));
// process.on('SIGTERM', () => disconnectAllMcpClients().then(() => process.exit(0)));
// Consider integrating this with the main app shutdown logic in index.ts instead
