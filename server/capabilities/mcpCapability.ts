/**
 * MCP capability — exposes tools auto-discovered from all connected
 * system-scoped MCP servers as a registered Capability.
 *
 * Because MCP tools are discovered at runtime (not at import time), this
 * module exports a factory that is called after mcpServerRegistry.start()
 * resolves.  The tools list is snapshotted at that point; if servers are
 * added/removed later, the capability needs to be re-registered.
 */

import type { Capability } from "./types";
import { mcpServerRegistry } from "../agent/mcp/mcpServerRegistry";

export function buildMcpCapability(): Capability {
  const tools = mcpServerRegistry.getSystemTools();
  return {
    id: "mcp",
    label: "MCP Servers",
    toolGroups: ["mcp"],
    tools,
  };
}
