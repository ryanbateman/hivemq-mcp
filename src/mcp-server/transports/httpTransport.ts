/**
 * @fileoverview Handles the setup and management of the Streamable HTTP MCP transport.
 * Includes Express server creation, middleware, request routing, session handling,
 * and port binding with retry logic.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import { randomUUID } from 'node:crypto';
// Import utils from the main barrel file (logger from ../../utils/internal/logger.js)
import { logger } from '../../utils/index.js';

// --- Configuration Constants ---

/**
 * The port number for the HTTP transport, configured via the MCP_HTTP_PORT environment variable.
 * Defaults to 3000 if the variable is not set or invalid.
 * @constant {number} HTTP_PORT - The port number for the HTTP server.
 */
const HTTP_PORT = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : 3000;

/**
 * The host address for the HTTP transport, configured via the MCP_HTTP_HOST environment variable.
 * Defaults to '127.0.0.1' (localhost) if the variable is not set.
 * @constant {string} HTTP_HOST - The host address for the HTTP server.
 */
const HTTP_HOST = process.env.MCP_HTTP_HOST || '127.0.0.1';

/**
 * The specific endpoint path for handling MCP requests over HTTP.
 * @constant {string} MCP_ENDPOINT_PATH - The URL path for MCP communication.
 */
const MCP_ENDPOINT_PATH = '/mcp';

/**
 * The maximum number of attempts to find an available port if the initial HTTP_PORT is in use.
 * The server will try `HTTP_PORT`, `HTTP_PORT + 1`, ..., `HTTP_PORT + MAX_PORT_RETRIES`.
 * @constant {number} MAX_PORT_RETRIES - Maximum retry attempts for port binding.
 */
const MAX_PORT_RETRIES = 15;

/**
 * A record (dictionary/map) to store active HTTP transport instances, keyed by their session ID.
 * This allows associating incoming HTTP requests with the correct ongoing MCP session.
 * @type {Record<string, StreamableHTTPServerTransport>}
 */
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Checks if an incoming HTTP request's origin header is permissible based on configuration.
 * It considers the `MCP_ALLOWED_ORIGINS` environment variable and whether the server
 * is bound to a loopback address (localhost). If allowed, it sets appropriate
 * Cross-Origin Resource Sharing (CORS) headers on the response.
 *
 * Security Note: Carefully configure `MCP_ALLOWED_ORIGINS` in production environments
 * to prevent unauthorized websites from interacting with the MCP server.
 *
 * @param {Request} req - The Express request object, containing headers like 'origin'.
 * @param {Response} res - The Express response object, used to set CORS headers.
 * @returns {boolean} Returns `true` if the origin is allowed, `false` otherwise.
 */
function isOriginAllowed(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  // Use req.hostname which correctly considers the Host header or falls back
  const host = req.hostname;
  // Check if the server is effectively bound only to loopback addresses
  const isLocalhostBinding = ['127.0.0.1', '::1', 'localhost'].includes(host);
  // Retrieve allowed origins from environment variable, split into an array
  const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(',') || [];

  // Determine if the origin is allowed:
  // 1. The origin header is present AND is in the configured allowed list.
  // OR
  // 2. The server is bound to localhost AND the origin header is missing or 'null' (common for local file access or redirects).
  const allowed = (origin && allowedOrigins.includes(origin)) || (isLocalhostBinding && (!origin || origin === 'null'));

  if (allowed && origin) {
    // If allowed and an origin was provided, set CORS headers to allow the specific origin.
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Allow necessary HTTP methods for MCP communication.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    // Allow standard MCP headers and Content-Type. Last-Event-ID is for SSE resumption.
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Last-Event-ID');
    // Set credentials allowance if needed (e.g., if cookies or authentication headers are involved).
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Adjust if using credentials
  } else if (allowed && !origin) {
     // Origin is allowed (e.g., localhost binding with missing/null origin), but no origin header to echo back.
     // No specific CORS headers needed in this case as there's no origin to restrict/allow.
  } else if (!allowed && origin) {
    // Log a warning if an origin was provided but is not allowed.
    logger.warning(`Origin denied: ${origin}`, { operation: 'isOriginAllowed', origin, host, allowedOrigins, isLocalhostBinding });
  }
  // Note: If !allowed and !origin, no action/logging is needed.

  return allowed;
}

/**
 * Proactively checks if a specific port is already in use by attempting to bind a temporary server.
 * @async
 * @param {number} port - The port number to check.
 * @param {string} host - The host address to check.
 * @param {Record<string, any>} context - Logging context.
 * @returns {Promise<boolean>} True if the port is in use (EADDRINUSE), false otherwise.
 */
async function isPortInUse(port: number, host: string, context: Record<string, any>): Promise<boolean> {
  return new Promise((resolve) => {
    const tempServer = http.createServer();
    tempServer
      .once('error', (err: NodeJS.ErrnoException) => {
        // If we get EADDRINUSE, the port is definitely in use.
        if (err.code === 'EADDRINUSE') {
          logger.debug(`Proactive check: Port ${port} on host ${host} is confirmed in use (EADDRINUSE).`, { ...context, port, host });
          resolve(true);
        } else {
          // Other errors might indicate issues but not necessarily that the port is *in use*
          // in a way that would prevent our main server from binding later (e.g., permissions).
          // We log these but resolve false, letting the main listen attempt handle it.
          logger.debug(`Proactive check: Encountered non-EADDRINUSE error on port ${port}: ${err.message}`, { ...context, port, host, errorCode: err.code });
          resolve(false);
        }
      })
      .once('listening', () => {
        // If we can listen, the port is free. Close the temp server immediately.
        logger.debug(`Proactive check: Port ${port} on host ${host} is available.`, { ...context, port, host });
        tempServer.close(() => resolve(false));
      })
      .listen(port, host);
  });
}


/**
 * Attempts to start the Node.js HTTP server on a specified port and host.
 * Uses a proactive check first, then attempts binding. If the initial port is already
 * in use (EADDRINUSE error), it increments the port number and retries,
 * up to a maximum number of retries (`maxRetries`).
 *
 * @async
 * @param {http.Server} serverInstance - The Node.js HTTP server instance to start.
 * number and retries, up to a maximum number of retries (`maxRetries`).
 *
 * @async
 * @param {http.Server} serverInstance - The Node.js HTTP server instance to start.
 * @param {number} initialPort - The first port number to attempt binding to.
 * @param {string} host - The host address to bind to (e.g., '127.0.0.1').
 * @param {number} maxRetries - The maximum number of additional ports to try (initialPort + 1, initialPort + 2, ...).
 * @param {Record<string, any>} context - Logging context to associate with log messages.
 * @returns {Promise<number>} A promise that resolves with the port number the server successfully bound to.
 * @throws {Error} Rejects if the server fails to bind to any port after all retries, or if a non-EADDRINUSE error occurs.
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
    // Loop through ports: initialPort, initialPort + 1, ..., initialPort + maxRetries
    for (let i = 0; i <= maxRetries; i++) {
      const currentPort = initialPort + i;

      // --- Proactive Port Check ---
      // First, check if the port seems to be in use before trying to bind the main server.
      // This helps catch cases where the main server's 'error' event might not fire reliably for EADDRINUSE.
      if (await isPortInUse(currentPort, host, context)) {
        logger.warning(`Proactive check detected port ${currentPort} is in use, retrying... (${i + 1}/${maxRetries + 1})`, { ...context, port: currentPort });
        lastError = new Error(`EADDRINUSE: Port ${currentPort} detected as in use by proactive check.`); // Set a placeholder error
        await new Promise(res => setTimeout(res, 100)); // Optional delay
        continue; // Skip to the next port
      }

      // --- Attempt to Bind Main Server ---
      try {
        // Attempt to listen on the current port and host with the main server instance.
        await new Promise<void>((listenResolve, listenReject) => {
          serverInstance.listen(currentPort, host, () => {
            // If listen succeeds immediately, log the success and resolve the inner promise.
            const serverAddress = `http://${host}:${currentPort}${MCP_ENDPOINT_PATH}`;
            logger.info(`HTTP transport successfully listening on host ${host} at ${serverAddress}`, { ...context, host, port: currentPort, address: serverAddress });
            listenResolve();
          }).on('error', (err: NodeJS.ErrnoException) => {
            // If an error occurs during listen (e.g., EADDRINUSE), reject the inner promise.
            listenReject(err);
          });
        });
        // If the inner promise resolved (listen was successful), resolve the outer promise with the port used.
        resolve(currentPort);
        return; // Exit the loop and the function.
      } catch (err: any) {
        lastError = err; // Store the error for potential final rejection message.
        // Log the specific error encountered during listen attempt
        logger.debug(`Listen error on port ${currentPort}: Code=${err.code}, Message=${err.message}`, { ...context, port: currentPort, errorCode: err.code, errorMessage: err.message });
        if (err.code === 'EADDRINUSE') {
          // If the port is in use, log a warning and continue to the next iteration.
          logger.warning(`Port ${currentPort} already in use (EADDRINUSE), retrying... (${i + 1}/${maxRetries + 1})`, { ...context, port: currentPort });
          // Optional delay before retrying to allow the other process potentially release the port.
          await new Promise(res => setTimeout(res, 100));
        } else {
          // If a different error occurred (e.g., permission denied), log it and reject immediately.
          logger.error(`Failed to bind to port ${currentPort}: ${err.message}`, { ...context, port: currentPort, error: err.message });
          reject(err);
          return; // Exit the loop and the function.
        }
      }
    }
    // If the loop completes without successfully binding to any port.
    logger.error(`Failed to bind to any port after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`, { ...context, initialPort, maxRetries, error: lastError?.message });
    reject(lastError || new Error('Failed to bind to any port after multiple retries.'));
  });
}

/**
 * Sets up and starts the HTTP transport layer.
 * Creates an Express app, configures middleware, defines MCP endpoints,
 * manages sessions, and starts the HTTP server with retry logic.
 *
 * @async
 * @param {() => Promise<McpServer>} createServerInstanceFn - An async function that creates a new, configured McpServer instance for each session.
 * @param {Record<string, any>} context - Logging context.
 * @returns {Promise<void>} A promise that resolves when the server is listening, or rejects on failure. The server runs indefinitely.
 * @throws {Error} Throws an error if the server fails to start after retries.
 */
export async function startHttpTransport(
  createServerInstanceFn: () => Promise<McpServer>,
  context: Record<string, any>
): Promise<void> {
  const app = express();
  // Middleware to parse JSON request bodies.
  app.use(express.json());

  // Handle CORS preflight (OPTIONS) requests.
  app.options(MCP_ENDPOINT_PATH, (req, res) => {
    if (isOriginAllowed(req, res)) {
      // Origin is allowed, send success status for preflight.
      res.sendStatus(204); // No Content
    } else {
      // Origin not allowed, send forbidden status. isOriginAllowed logs the warning.
      res.status(403).send('Forbidden: Invalid Origin');
    }
  });

  // Middleware for all requests to check origin and set security headers.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isOriginAllowed(req, res)) {
      // Origin not allowed, block the request. isOriginAllowed logs the warning.
      res.status(403).send('Forbidden: Invalid Origin');
      return; // Stop processing the request.
    }
    // Set standard security headers for allowed requests.
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME type sniffing.
    // Consider adding other headers like Content-Security-Policy (CSP), Strict-Transport-Security (HSTS) here.
    next(); // Origin is allowed, proceed to the specific route handler.
  });


  // Handle POST requests (Initialization and subsequent messages).
  app.post(MCP_ENDPOINT_PATH, async (req, res) => {
    // Extract session ID from the custom MCP header.
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    // Look up existing transport for this session.
    let transport = sessionId ? httpTransports[sessionId] : undefined;
    // Check if the request body is an MCP Initialize request.
    const isInitReq = isInitializeRequest(req.body);
    const requestId = (req.body as any)?.id || null; // For error responses

    try {
      // --- Handle Initialization Request ---
      if (isInitReq) {
        if (transport) {
          // This indicates a potential client error or session ID collision (very unlikely).
          logger.warning('Received initialize request on an existing session ID. Closing old session.', { ...context, sessionId });
          // Close the old transport cleanly before creating a new one.
          await transport.close(); // Assuming close is async and handles cleanup
          delete httpTransports[sessionId!]; // Remove from map
        }

        logger.info('Initializing new session via POST request', { ...context, bodyPreview: JSON.stringify(req.body).substring(0, 100) }); // Log preview for debugging

        // Create a new streamable HTTP transport for this session.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(), // Generate a unique session ID.
          onsessioninitialized: (newId) => {
            // Store the transport instance in the map once the session ID is generated.
            httpTransports[newId] = transport!;
            logger.info(`HTTP Session created: ${newId}`, { ...context, sessionId: newId });
          },
        });

        // Define cleanup logic when the transport closes (e.g., client disconnects, DELETE request).
        transport.onclose = () => {
          if (transport!.sessionId) {
            delete httpTransports[transport!.sessionId];
            logger.info(`HTTP Session closed: ${transport!.sessionId}`, { ...context, sessionId: transport!.sessionId });
          }
        };

        // Create a dedicated McpServer instance for this new session using the provided factory function.
        const server = await createServerInstanceFn();
        // Connect the server logic to the transport layer.
        await server.connect(transport);
        // Note: The transport handles sending the initialize response internally upon connection.
        // We still need to call handleRequest below to process the *content* of the initialize message.

      } else if (!transport) {
        // --- Handle Non-Initialize Request without Valid Session ---
        // If it's not an initialization request, but no transport was found for the session ID.
        logger.warning('Invalid session ID provided for non-initialize POST request', { ...context, sessionId });
        res.status(404).json({ jsonrpc: '2.0', error: { code: -32004, message: 'Invalid or expired session ID' }, id: requestId });
        return; // Stop processing.
      }

      // --- Handle Request (Initialize or Subsequent Message) ---
      // At this point, 'transport' must be defined (either found or newly created).
      if (!transport) {
         // Defensive check: This state should not be reachable if logic above is correct.
         logger.error('Internal error: Transport is unexpectedly undefined before handleRequest', { ...context, sessionId, isInitReq });
         throw new Error('Internal server error: Transport unavailable');
      }
      // Delegate the actual handling of the request (parsing, routing to server, sending response)
      // to the transport instance. This works for both the initial initialize message and subsequent messages.
      await transport.handleRequest(req, res, req.body);

    } catch (err) {
      // Catch-all for errors during POST handling.
      logger.error('Error handling POST request', {
          ...context,
          sessionId,
          isInitReq,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
      });
      // Send a generic JSON-RPC error response if headers haven't been sent yet.
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error during POST handling' }, id: requestId });
      }
      // Ensure transport is cleaned up if an error occurred during initialization
      if (isInitReq && transport && !transport.sessionId) {
          // If init failed before session ID was assigned, manually trigger cleanup if needed
          await transport.close().catch(closeErr => logger.error('Error closing transport after init failure', { ...context, closeError: closeErr }));
      }
    }
  });

  // Unified handler for GET (SSE connection) and DELETE (session termination).
  const handleSessionReq = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? httpTransports[sessionId] : undefined;
    const method = req.method; // GET or DELETE

    if (!transport) {
      logger.warning(`Session not found for ${method} request`, { ...context, sessionId, method });
      res.status(404).send('Session not found or expired');
      return;
    }

    try {
      // Delegate handling to the transport (establishes SSE for GET, triggers close for DELETE).
      await transport.handleRequest(req, res);
      logger.info(`Successfully handled ${method} request for session`, { ...context, sessionId, method });
    } catch (err) {
      logger.error(`Error handling ${method} request for session`, {
          ...context,
          sessionId,
          method,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
      });
      // Send generic error if headers not sent (e.g., error before SSE connection established).
      if (!res.headersSent) {
          res.status(500).send('Internal Server Error');
      }
      // Note: If SSE connection was established, errors might need different handling (e.g., sending error event).
      // The transport's handleRequest should manage SSE-specific error reporting.
    }
  };
  // Route GET and DELETE requests to the unified handler.
  app.get(MCP_ENDPOINT_PATH, handleSessionReq);
  app.delete(MCP_ENDPOINT_PATH, handleSessionReq);

  // --- Start HTTP Server ---
  const serverInstance = http.createServer(app);
  try {
    // Attempt to start the server, retrying ports if necessary.
    const actualPort = await startHttpServerWithRetry(serverInstance, HTTP_PORT, HTTP_HOST, MAX_PORT_RETRIES, context);
    // Log the final address only after successful binding.
    const serverAddress = `http://${HTTP_HOST}:${actualPort}${MCP_ENDPOINT_PATH}`;
    // Use console.log for prominent startup message visibility.
    console.log(`\n🚀 MCP Server running in HTTP mode at: ${serverAddress}\n`);
  } catch (err) {
    // If startHttpServerWithRetry failed after all retries.
    logger.fatal('HTTP server failed to start after multiple port retries.', { ...context, error: err instanceof Error ? err.message : String(err) });
    // Rethrow or exit, as the server cannot run.
    throw err;
  }
}
