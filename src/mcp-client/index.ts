/**
 * Barrel file for the MCP Client module.
 * Exports the primary functions for creating, connecting, and managing MCP client instances.
 */

export {
  connectMcpClient, disconnectAllMcpClients, disconnectMcpClient, type ConnectedMcpClient // Export the type alias as well
} from './client.js';

// Optionally, re-export config types or loader functions if needed externally
export {
  getMcpServerConfig, loadMcpClientConfig, type McpServerConfigEntry
} from './configLoader.js';

// Re-export transport functions, especially getClientTransport which now handles multiple types
export { createStdioClientTransport, getClientTransport } from './transport.js';
