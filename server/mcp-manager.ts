/**
 * MCP Client Manager — creates, caches, and exposes MCP tools for streamText().
 *
 * Manages MCP client lifecycle with config-based caching. Clients are reused
 * when their config hasn't changed and recreated when it has.
 */
import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';

import type {
  MCPHTTPConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPStdioConfig,
} from '../src/types/mcp';

/** Separator used to namespace tool names: serverName__toolName */
const TOOL_NS_SEP = '__';

/** Cached client entry */
interface CachedClient {
  client: MCPClient;
  configHash: string;
}

/** Global client cache keyed by server ID */
const clientCache = new Map<string, CachedClient>();

/**
 * Compute a simple hash string from the transport-relevant parts of a config.
 * Used to detect config changes and invalidate cached clients.
 */
function computeConfigHash(config: MCPServerConfig): string {
  const parts: string[] = [config.id, config.transport];
  switch (config.transport) {
    case 'stdio':
      parts.push(config.command, ...config.args, JSON.stringify(config.env));
      break;
    case 'sse':
    case 'http':
      parts.push(config.url, JSON.stringify(config.headers ?? {}));
      break;
  }
  return parts.join('|');
}

/**
 * Create an MCP client for the given server config.
 */
async function createClient(config: MCPServerConfig): Promise<MCPClient> {
  switch (config.transport) {
    case 'stdio': {
      const stdioConfig = config as MCPStdioConfig;
      const transport = new Experimental_StdioMCPTransport({
        command: stdioConfig.command,
        args: stdioConfig.args,
        env: { ...(process.env as Record<string, string>), ...stdioConfig.env },
      });
      return createMCPClient({ transport });
    }
    case 'sse': {
      const sseConfig = config as MCPSSEConfig;
      return createMCPClient({
        transport: {
          type: 'sse',
          url: sseConfig.url,
          headers: sseConfig.headers,
        },
      });
    }
    case 'http': {
      const httpConfig = config as MCPHTTPConfig;
      return createMCPClient({
        transport: {
          type: 'http',
          url: httpConfig.url,
          headers: httpConfig.headers,
        },
      });
    }
  }
}

/**
 * Get or create a cached MCP client for the given config.
 * Closes and replaces the client if the config has changed.
 */
async function getOrCreateClient(config: MCPServerConfig): Promise<MCPClient> {
  const hash = computeConfigHash(config);
  const cached = clientCache.get(config.id);

  if (cached && cached.configHash === hash) {
    return cached.client;
  }

  // Config changed — close old client if it exists
  if (cached) {
    try {
      await cached.client.close();
    } catch {
      // Ignore close errors
    }
  }

  const client = await createClient(config);
  clientCache.set(config.id, { client, configHash: hash });
  return client;
}

/**
 * Given an array of MCP server configs, create clients and collect all their tools.
 * Returns a merged tools object compatible with `streamText({ tools: ... })`.
 *
 * Tools are namespaced as `serverName__toolName` to avoid collisions.
 * If a server fails to connect, it is skipped with a warning logged.
 *
 * @param configs - Array of enabled MCP server configurations
 * @returns Object with `tools` record and `cleanup` function
 */
export async function getMCPTools(
  configs: MCPServerConfig[]
): Promise<{ tools: Record<string, unknown>; cleanup: () => Promise<void> }> {
  const tools: Record<string, unknown> = {};
  const activeIds = new Set<string>();

  // Connect to each server and gather tools in parallel
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const client = await getOrCreateClient(config);
      const serverTools = await client.tools();
      return { config, serverTools };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { config, serverTools } = result.value;
      activeIds.add(config.id);

      // Namespace each tool with the server name
      const prefix = sanitizeName(config.name);
      for (const [toolName, tool] of Object.entries(serverTools)) {
        tools[`${prefix}${TOOL_NS_SEP}${toolName}`] = tool;
      }
    } else {
      console.warn('[MCP Manager] Failed to connect to MCP server:', result.reason);
    }
  }

  /**
   * Cleanup function: close clients that are no longer in the active config set.
   * Cached clients that are still active are kept for reuse.
   */
  const cleanup = async () => {
    const staleIds: string[] = [];
    for (const id of clientCache.keys()) {
      if (!activeIds.has(id)) {
        staleIds.push(id);
      }
    }
    await Promise.allSettled(
      staleIds.map(async (id) => {
        const cached = clientCache.get(id);
        if (cached) {
          clientCache.delete(id);
          await cached.client.close();
        }
      })
    );
  };

  return { tools, cleanup };
}

/**
 * Check connectivity and list tools for each MCP server config.
 * Returns per-server status (connected/error) and tool names.
 */
export async function getMCPServerStatus(configs: MCPServerConfig[]): Promise<
  Array<{
    name: string;
    id: string;
    status: 'connected' | 'error';
    tools: string[];
    error?: string;
  }>
> {
  if (!configs || configs.length === 0) return [];

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const client = await getOrCreateClient(config);
      const serverTools = await client.tools();
      return {
        name: config.name,
        id: config.id,
        status: 'connected' as const,
        tools: Object.keys(serverTools),
      };
    })
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const err = result.reason as Error;
    return {
      name: configs[i].name,
      id: configs[i].id,
      status: 'error' as const,
      tools: [],
      error: err?.message ?? 'Unknown error',
    };
  });
}

/**
 * Close all cached MCP clients. Call on graceful server shutdown.
 */
export async function closeAllMCPClients(): Promise<void> {
  const entries = [...clientCache.entries()];
  clientCache.clear();
  await Promise.allSettled(
    entries.map(async ([, { client }]) => {
      await client.close();
    })
  );
}

/**
 * Sanitize a server name for use as a tool namespace prefix.
 * Converts to lowercase, replaces non-alphanumeric chars with underscores.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
