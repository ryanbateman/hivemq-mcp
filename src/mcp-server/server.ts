import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import { randomUUID } from 'node:crypto';
import { config, environment } from '../config/index.js';
import { ErrorHandler } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { requestContextService } from '../utils/requestContext.js';
import { registerEchoResource } from './resources/echoResource/index.js';
import { registerEchoTool } from './tools/echoTool/index.js';

// --- Configuration Constants ---
const TRANSPORT_TYPE = (process.env.MCP_TRANSPORT_TYPE || 'stdio').toLowerCase();
const HTTP_PORT = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : 3000;
const HTTP_HOST = process.env.MCP_HTTP_HOST || '127.0.0.1';
const MCP_ENDPOINT_PATH = '/mcp';
const MAX_PORT_RETRIES = 15; // Maximum number of port retries

// Map to store active HTTP transports by session ID
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Checks if an HTTP request's origin is allowed based on environment configuration
 * and localhost binding status. Sets CORS headers if allowed.
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @returns {boolean} True if the origin is allowed, false otherwise.
 */
function isOriginAllowed(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  // Use req.hostname which correctly considers the Host header or falls back
  const host = req.hostname;
  // Check if the server is effectively bound only to loopback addresses
  const isLocalhostBinding = ['127.0.0.1', '::1', 'localhost'].includes(host);
  const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(',') || [];

  // Allow if origin is in the list OR if bound to localhost and origin is missing/null
  const allowed = (origin && allowedOrigins.includes(origin)) || (isLocalhostBinding && (!origin || origin === 'null'));

  if (allowed && origin) {
    // Set CORS header ONLY if origin is present and allowed
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Add other necessary CORS headers dynamically based on request or keep static
    // Example: Allow common MCP headers
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Last-Event-ID');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Adjust if using credentials
  } else if (allowed && !origin) {
     // Origin is allowed (e.g. localhost binding with missing/null origin), but no origin header to echo back.
     // Decide if you need default CORS headers here. Usually not needed if no origin is sent.
  }

  return allowed;
}


/**
 * Creates and configures an MCP server instance with resources, tools, and logging.
 * Designed for reuse in stateless HTTP request handling or a single stdio process.
 *
 * @async
 * @returns {Promise<McpServer>} Configured MCP server instance
 * @throws {Error} If registration of resources/tools fails
 */
async function createMcpServerInstance(): Promise<McpServer> {
  const context = { operation: 'createMcpServerInstance' };
  logger.info('Initializing MCP server instance', context);

  // Configure request-scoped context for logging or tracing
  requestContextService.configure({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment,
  });

  // Instantiate server with declared capabilities
  const server = new McpServer(
    { name: config.mcpServerName, version: config.mcpServerVersion },
    { capabilities: { logging: {}, resources: { listChanged: true }, tools: { listChanged: true } } }
  );

  try {
    // Register domain-specific resources and tools
    await registerEchoResource(server);
    await registerEchoTool(server);
    logger.info('Resources and tools registered successfully', context);
  } catch (err) {
    logger.error('Failed to register resources/tools', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return server;
}

/**
 * Attempts to start the HTTP server, retrying on port conflicts.
 * @param serverInstance The HTTP server instance.
 * @param initialPort The starting port number.
 * @param host The host address.
 * @param maxRetries Maximum number of retries.
 * @param context Logging context.
 * @returns Promise resolving with the actual port used, or rejecting if unable to bind.
 */
function startHttpServerWithRetry(
  serverInstance: http.Server,
  initialPort: number,
  host: string,
  maxRetries: number,
  context: Record<string, any>
): Promise<number> {
  return new Promise(async (resolve, reject) => {
    let lastError: Error | null = null;
    for (let i = 0; i <= maxRetries; i++) {
      const currentPort = initialPort + i;
      try {
        await new Promise<void>((listenResolve, listenReject) => {
          serverInstance.listen(currentPort, host, () => {
            logger.info(`HTTP transport listening at http://${host}:${currentPort}${MCP_ENDPOINT_PATH}`, { ...context, port: currentPort });
            listenResolve();
          }).on('error', (err: NodeJS.ErrnoException) => {
            listenReject(err);
          });
        });
        // If listen succeeded, resolve with the port used
        resolve(currentPort);
        return; // Exit the loop and promise
      } catch (err: any) {
        lastError = err; // Store the error
        if (err.code === 'EADDRINUSE') {
          logger.warning(`Port ${currentPort} already in use, retrying... (${i + 1}/${maxRetries + 1})`, { ...context, port: currentPort });
          // Optional: Add a small delay before retrying
          await new Promise(res => setTimeout(res, 100));
        } else {
          // For other errors, reject immediately
          logger.error(`Failed to bind to port ${currentPort}: ${err.message}`, { ...context, port: currentPort, error: err.message });
          reject(err);
          return; // Exit the loop and promise
        }
      }
    }
    // If loop finishes without success
    logger.error(`Failed to bind to any port after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`, { ...context, initialPort, maxRetries, error: lastError?.message });
    reject(lastError || new Error('Failed to bind to any port after multiple retries.'));
  });
}


/**
 * Sets up and starts the specified transport (stdio or HTTP).
 * For HTTP: manages sessions, CORS, and SSE streams via Express.
 * For stdio: connects a single transport to stdout/stdin.
 *
 * @async
 * @returns {Promise<McpServer | void>} MCP server instance for stdio transport
 */
async function startTransport(): Promise<McpServer | void> {
  const context = { operation: 'startTransport', transport: TRANSPORT_TYPE };
  logger.info(`Starting transport: ${TRANSPORT_TYPE}`, context);

  if (TRANSPORT_TYPE === 'http') {
    const app = express();
    app.use(express.json());

    // Preflight handler for CORS using the helper function
    app.options(MCP_ENDPOINT_PATH, (req, res) => {
      if (isOriginAllowed(req, res)) {
        res.sendStatus(204); // OK, Preflight successful
      } else {
        // isOriginAllowed already logged the warning if applicable
        res.status(403).send('Forbidden: Invalid Origin');
      }
    });

    // Middleware for origin checks and security headers using the helper function
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!isOriginAllowed(req, res)) {
        // isOriginAllowed already logged the warning if applicable
        // Note: No need to log again here unless adding more detail
        res.status(403).send('Forbidden: Invalid Origin');
        return; // Stop processing
      }
      // Set additional security headers if needed
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Potentially add other headers like CSP, HSTS etc. here
      next(); // Origin is allowed, proceed to next middleware/handler
    });


    // Handle initialization and message POSTs
    app.post(MCP_ENDPOINT_PATH, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport = sessionId ? httpTransports[sessionId] : undefined;

      try {
        if (!transport && isInitializeRequest(req.body)) {
          logger.info('Initializing new session', context);
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newId) => {
              httpTransports[newId] = transport!;
              logger.info(`Session created: ${newId}`, { ...context, sessionId: newId });
            },
          });
          transport.onclose = () => {
            if (transport!.sessionId) {
              delete httpTransports[transport!.sessionId];
              logger.info(`Session closed: ${transport!.sessionId}`, context);
            }
          };
          const server = await createMcpServerInstance();
          await server.connect(transport);
        } else if (!transport) {
          logger.warning('Invalid session for POST', context);
          res.status(404).json({ jsonrpc: '2.0', error: { code: -32004, message: 'Invalid session' }, id: null });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        logger.error('Error handling POST', { ...context, error: err instanceof Error ? err.message : String(err) });
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: (req.body as any)?.id || null });
        }
      }
    });

    // Unified GET and DELETE handler for SSE and session cleanup
    const handleSessionReq = async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const transport = sessionId ? httpTransports[sessionId] : undefined;
      if (!transport) {
        logger.warning(`No transport for ${req.method}`, context);
        res.status(404).send('Session not found');
        return;
      }
      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        logger.error(`Error on ${req.method}`, { ...context, error: err instanceof Error ? err.message : String(err) });
        if (!res.headersSent) res.status(500).send('Internal Server Error');
      }
    };
    app.get(MCP_ENDPOINT_PATH, handleSessionReq);
    app.delete(MCP_ENDPOINT_PATH, handleSessionReq);

    // Start HTTP server with retry logic
    const serverInstance = http.createServer(app);
    try {
      await startHttpServerWithRetry(serverInstance, HTTP_PORT, HTTP_HOST, MAX_PORT_RETRIES, context);
    } catch (err) {
      // If startHttpServerWithRetry rejects (couldn't bind after retries), rethrow
      throw err;
    }
    // If successful, the promise resolves, and we continue.
    return; // Return void as the server is running
  }

  if (TRANSPORT_TYPE === 'stdio') {
    try {
      const server = await createMcpServerInstance();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('Connected via stdio', context);
      return server;
    } catch (err) {
      ErrorHandler.handleError(err, { operation: 'stdioConnect', critical: true });
      throw err;
    }
  }

  throw new Error(`Unsupported transport: ${TRANSPORT_TYPE}`);
}

/**
 * Main entry point: initializes and starts MCP server.
 */
export async function initializeAndStartServer(): Promise<void | McpServer> {
  try {
    return await startTransport();
  } catch (err) {
    logger.error('Failed to start MCP server', { error: err instanceof Error ? err.message : String(err) });
    ErrorHandler.handleError(err, { operation: 'initializeAndStartServer', critical: true });
    process.exit(1);
  }
}
