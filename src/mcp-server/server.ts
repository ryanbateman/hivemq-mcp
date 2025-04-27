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

// Map to store active HTTP transports by session ID
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

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

    // Preflight handler for CORS
    app.options(MCP_ENDPOINT_PATH, (req, res) => {
      const origin = req.headers.origin;
      const isLocal = ['127.0.0.1', '::1', 'localhost'].includes(req.hostname);
      const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(',') || [];
      const allowed = (origin && allowedOrigins.includes(origin)) || (isLocal && (!origin || origin === 'null'));
      if (allowed && origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Last-Event-ID');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.sendStatus(204);
    });

    // Middleware for basic origin checks and security headers
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      const isLocal = ['127.0.0.1', '::1', 'localhost'].includes(req.hostname);
      const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(',') || [];
      const allowed = (origin && allowedOrigins.includes(origin)) || (isLocal && (!origin || origin === 'null'));

      if (!allowed) {
        logger.warning(`Blocked CORS origin: ${origin}`, context);
        res.status(403).send('Forbidden: Invalid Origin');
        return;
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
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

    // Start HTTP server
    const serverInstance = http.createServer(app);
    return new Promise<void>((resolve, reject) => {
      serverInstance.listen(HTTP_PORT, HTTP_HOST, () => {
        logger.info(`HTTP transport listening at http://${HTTP_HOST}:${HTTP_PORT}${MCP_ENDPOINT_PATH}`, context);
        resolve();
      }).on('error', (err) => reject(err));
    });
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
