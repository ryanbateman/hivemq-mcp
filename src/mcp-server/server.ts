import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { NextFunction, Request, Response } from 'express';
import http from 'http'; // Import Node's http module
import { randomUUID } from "node:crypto";
import { config, environment } from '../config/index.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { requestContextService } from "../utils/requestContext.js";
import { registerEchoResource } from './resources/echoResource/index.js';
import { registerEchoTool } from './tools/echoTool/index.js';

// --- Configuration ---
const TRANSPORT_TYPE = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase(); // Default to stdio
const HTTP_PORT = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : 3000;
const HTTP_HOST = process.env.MCP_HTTP_HOST || '127.0.0.1'; // Default to localhost for security
const MCP_ENDPOINT_PATH = '/mcp'; // Define the single endpoint path for Streamable HTTP

// Map to store transports by session ID for HTTP transport
const httpTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

/**
 * Creates and configures the core McpServer instance and registers capabilities.
 * This function is designed to be called potentially multiple times for stateless HTTP handling.
 *
 * @async
 * @function createMcpServerInstance
 * @returns {Promise<McpServer>} A promise that resolves with the configured McpServer instance.
 * @throws {Error} Throws an error if critical failures occur during registration.
 */
const createMcpServerInstance = async (): Promise<McpServer> => {
  const operationContext = { operation: 'CreateServerInstance' };
  logger.info("Creating MCP server instance...", operationContext);

  // Configure request context (ensure this is safe if called multiple times)
  requestContextService.configure({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment: environment
  });
  // logger.debug("Request context service configured.", operationContext); // Maybe too verbose if called per request

  // Create the server instance with base capabilities
  const server = new McpServer(
    {
      name: config.mcpServerName,
      version: config.mcpServerVersion,
    },
    {
      capabilities: {
        logging: {},
        resources: { listChanged: true, subscribe: true },
        tools: { listChanged: true },
        // completions: {}, // Add if implemented
      },
    }
  );
  // logger.debug("McpServer instance created.", { ...operationContext, serverName: config.mcpServerName });

  // Register resources and tools
  try {
    // logger.info("Registering resources and tools...", operationContext); // Maybe too verbose
    await registerEchoResource(server);
    // logger.debug("Echo resource registered.", operationContext);
    await registerEchoTool(server);
    // logger.debug("Echo tool registered.", operationContext);
    // logger.info("Resources and tools registered successfully.", operationContext);
  } catch (registrationError) {
     logger.error("Critical error during resource/tool registration process", {
        ...operationContext,
        error: registrationError instanceof Error ? registrationError.message : String(registrationError),
        stack: registrationError instanceof Error ? registrationError.stack : undefined,
     });
     throw registrationError; // Halt server startup or request handling
  }

  // logger.info("MCP server instance configured.", operationContext);
  return server;
};

/**
 * Starts the appropriate transport (stdio or HTTP) based on MCP_TRANSPORT_TYPE env var.
 *
 * @async
 * @function startServerTransport
 * @returns {Promise<McpServer | void>} A promise that resolves with the McpServer instance for stdio transport, or void for http, or rejects on failure.
 * @throws {Error} Throws an error if critical failures occur during transport setup.
 */
const startServerTransport = async (): Promise<McpServer | void> => {
  const operationContext = { operation: 'StartTransport', transport: TRANSPORT_TYPE };
  logger.info(`Starting MCP server transport: ${TRANSPORT_TYPE}`, operationContext);

  if (TRANSPORT_TYPE === 'http') {
    // --- Start Streamable HTTP Transport with Session Management ---
    try {
      logger.info(`Setting up Streamable HTTP transport on ${HTTP_HOST}:${HTTP_PORT}${MCP_ENDPOINT_PATH}`, operationContext);

      const app = express();
      // Middleware for parsing JSON bodies
      app.use(express.json());

      // Middleware for logging requests and basic security checks
      app.use((req: Request, res: Response, next: NextFunction): void => {
        const meta = { ...operationContext, httpMethod: req.method, url: req.url, origin: req.headers.origin, sessionId: req.headers['mcp-session-id'] };
        logger.debug(`HTTP Request Received: ${req.method} ${req.url}`, meta);

        // Basic Origin check - IMPORTANT: For production, use a robust allowlist and proper CORS configuration.
        const origin = req.headers.origin;
        if (HTTP_HOST === '127.0.0.1' || HTTP_HOST === 'localhost') {
            logger.debug('Accepting request on localhost.', meta);
        } else if (origin) {
            const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(',') || [];
            if (!allowedOrigins.includes(origin)) {
                logger.warn(`Forbidden: Invalid Origin: ${origin}`, meta);
                res.status(403).send('Forbidden: Invalid Origin');
                return;
            }
        } else if (req.method !== 'GET' && (HTTP_HOST !== '127.0.0.1' && HTTP_HOST !== 'localhost')) {
             logger.warn(`Forbidden: Missing Origin header for ${req.method} request from non-localhost`, meta);
             res.status(403).send('Forbidden: Origin header required');
             return;
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        next();
      });

      // Handle POST requests (Client -> Server messages)
      app.post(MCP_ENDPOINT_PATH, async (req, res) => {
        const postOperationContext = { ...operationContext, httpMethod: 'POST', url: MCP_ENDPOINT_PATH };
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport | undefined = sessionId ? httpTransports[sessionId] : undefined;
        let server: McpServer | undefined;

        try {
            if (transport) {
                logger.debug(`Reusing existing transport for session: ${sessionId}`, postOperationContext);
            } else if (!sessionId && isInitializeRequest(req.body)) {
                logger.info(`New initialization request received. Creating new transport and server instance.`, postOperationContext);
                // Create a new transport for the new session
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(), // Generate session ID
                    onsessioninitialized: (newSessionId) => {
                        if (transport) { // Ensure transport is defined
                            httpTransports[newSessionId] = transport; // Store transport by new session ID
                            logger.info(`Session initialized: ${newSessionId}`, { ...postOperationContext, sessionId: newSessionId });
                        }
                    }
                });

                // Clean up transport when closed
                transport.onclose = () => {
                    if (transport?.sessionId && httpTransports[transport.sessionId]) {
                        logger.info(`Session closed, removing transport: ${transport.sessionId}`, { ...postOperationContext, sessionId: transport.sessionId });
                        delete httpTransports[transport.sessionId];
                    }
                };

                // Create a new server instance for this session
                server = await createMcpServerInstance();
                await server.connect(transport); // Connect the specific server instance
                logger.debug(`New server instance connected for potential session.`, postOperationContext);

            } else {
                logger.warn(`Bad Request: No valid session ID provided for non-initialize request or invalid initialize request.`, { ...postOperationContext, sessionId });
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Bad Request: No valid session ID provided or invalid initialize request' },
                    id: null,
                });
                return;
            }

            // Handle the request using the determined transport
            await transport.handleRequest(req, res, req.body);
            logger.debug(`POST request handled for session: ${transport.sessionId || '(pending init)'}`, postOperationContext);

        } catch (error) {
            logger.error("Error handling POST request", {
                ...postOperationContext,
                sessionId: transport?.sessionId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error during POST handling' },
                    id: (req.body as any)?.id ?? null, // Try to get ID from request body
                });
            }
        }
      });

      // Reusable handler for GET (SSE) and DELETE (Session Termination)
      const handleSessionRequest = async (req: express.Request, res: express.Response) => {
        const sessionOperationContext = { ...operationContext, httpMethod: req.method, url: MCP_ENDPOINT_PATH };
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (!sessionId || !httpTransports[sessionId]) {
            logger.warn(`Invalid or missing session ID for ${req.method} request.`, { ...sessionOperationContext, sessionId });
            res.status(400).send('Invalid or missing session ID');
            return;
        }

        const transport = httpTransports[sessionId];
        try {
            await transport.handleRequest(req, res);
            logger.debug(`${req.method} request handled for session: ${sessionId}`, sessionOperationContext);
            // For DELETE, the transport should handle cleanup via its onclose handler triggered by handleRequest
        } catch (error) {
             logger.error(`Error handling ${req.method} request for session: ${sessionId}`, {
                ...sessionOperationContext,
                sessionId: sessionId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            if (!res.headersSent) {
                 // Avoid sending error if SSE stream already started, etc.
                 res.status(500).send('Internal Server Error');
            }
        }
      };

      // Handle GET requests (Server -> Client SSE stream)
      app.get(MCP_ENDPOINT_PATH, handleSessionRequest);

      // Handle DELETE requests (Session Termination)
      app.delete(MCP_ENDPOINT_PATH, handleSessionRequest);

      // Start listening
      const httpServerInstance = http.createServer(app);
      await new Promise<void>((resolve, reject) => {
        httpServerInstance.listen(HTTP_PORT, HTTP_HOST, () => {
          logger.info(`${config.mcpServerName} listening via HTTP on http://${HTTP_HOST}:${HTTP_PORT}${MCP_ENDPOINT_PATH}`, {
            ...operationContext, serverName: config.mcpServerName, version: config.mcpServerVersion, host: HTTP_HOST, port: HTTP_PORT
          });
          resolve();
        });
        httpServerInstance.on('error', (error) => {
          logger.error("HTTP server failed to start.", { ...operationContext, error: error.message });
          reject(error);
        });
      });

    } catch (httpError) {
      ErrorHandler.handleError(httpError, {
        operation: 'HttpTransportSetup', context: operationContext, critical: true, rethrow: true
      });
      throw httpError;
    }

  } else if (TRANSPORT_TYPE === 'stdio') {
    // --- Start Stdio Transport (Supported) ---
    try {
      logger.info("Connecting server via Stdio transport...", operationContext);
      // Create a single server instance for stdio
      const server = await createMcpServerInstance();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info(`${config.mcpServerName} connected successfully via stdio`, {
        ...operationContext, serverName: config.mcpServerName, version: config.mcpServerVersion
      });
      // For stdio, return the server instance so it can be used for shutdown
      return server;
    } catch (stdioError) {
      ErrorHandler.handleError(stdioError, {
        operation: 'StdioConnection', context: operationContext, critical: true, rethrow: true
      });
      throw stdioError;
    }

  } else {
    const error = new Error(`Unsupported MCP_TRANSPORT_TYPE: '${TRANSPORT_TYPE}'. Use 'stdio' or 'http'.`);
    logger.error(error.message, operationContext);
    throw error;
  }
};

/**
 * Initializes and starts the MCP Server with the configured transport.
 * This is the main entry point for the server application.
 *
 * @async
 * @function initializeAndStartServer
 * @returns {Promise<McpServer | void>} A promise that resolves with the McpServer instance (for stdio) or void (for http) when the server is running, or rejects on critical failure.
 */
export const initializeAndStartServer = async (): Promise<McpServer | void> => {
  try {
    // For stdio, createMcpServerInstance is called within startServerTransport.
    // For http, server instances are created per session within the POST handler.
    // We just need to start the transport listener here.
    // startServerTransport now returns the server instance for stdio
    return startServerTransport();
    // For stdio, the process waits for stdin to close.
    // For http, the listener keeps the process alive.
  } catch (error) {
    logger.error("Server failed to initialize and start.", { // Changed from fatal
        operation: 'InitializeAndStart',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    });
    ErrorHandler.handleError(error, { operation: 'InitializeAndStart', critical: true });
    process.exit(1); // Ensure exit on critical startup failure
  }
};
