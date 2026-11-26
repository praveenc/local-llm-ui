/**
 * Which MCP servers the app may start.
 *
 * Shared by the status check and the chat request. A server that you are still typing (no name,
 * no command, no URL) must never start: a half-typed `npx -y @scope/p` would run whatever package
 * has that name.
 */
import { validateMCPServerConfig } from '../types/mcp.ts';
import type { MCPServerConfig, MCPServersMap } from '../types/mcp.ts';

/** The window gets this event when the servers should be checked again (Preferences closed) */
export const MCP_SERVERS_CHECK_EVENT = 'mcp-servers-check';

/** The enabled servers that pass `validateMCPServerConfig`, in the order of the map */
export function checkableServers(servers: MCPServersMap | undefined): MCPServerConfig[] {
  return Object.values(servers ?? {}).filter(
    (server) => server.enabled && validateMCPServerConfig(server) === null
  );
}
