/**
 * @fileoverview Barrel file for the `Health API` resource.
 * This file serves as the public interface for the health API resource module,
 * primarily exporting the `registerHealthAPIResource` function. This function is
 * responsible for registering the Health API resource, including its templates and handler,
 * with an MCP server instance. This makes the resource accessible to clients
 * via defined URI patterns.
 *
 * Consuming modules should import from this barrel file to access
 * the echo resource's registration capabilities.
 * @module src/mcp-server/resources/healthAPIResource/index
 */

export { registerHealthAPIResource } from "./registration.js";
