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

const sortedEntries = (record: Record<string, string> | undefined): Array<[string, string]> =>
  Object.entries(record ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * A string that changes when the way the app starts or reaches a server changes: the transport,
 * the command, arguments and environment of a local server, or the URL and headers of a remote
 * one. The name, the description, and the enabled switch are not part of it. A check result is
 * valid only for the key that it was made with. The order of environment variables and headers
 * does not matter; the order of arguments does.
 */
export function serverConnectionKey(config: MCPServerConfig): string {
  if (config.transport === 'stdio') {
    return JSON.stringify(['stdio', config.command, config.args, sortedEntries(config.env)]);
  }
  return JSON.stringify([config.transport, config.url, sortedEntries(config.headers)]);
}

/** How many tool names the check result lists before it says "and N more" */
export const MAX_LISTED_TOOLS = 10;

/** Tool names in one line: the first ones, comma separated, then "and N more" */
export function summarizeToolNames(tools: string[], limit: number = MAX_LISTED_TOOLS): string {
  const listed = tools.slice(0, limit).join(', ');
  const more = tools.length - limit;
  return more > 0 ? `${listed} and ${more} more` : listed;
}
