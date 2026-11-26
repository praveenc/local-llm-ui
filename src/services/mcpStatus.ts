/** Asks the server to connect to MCP servers and list their tools */
import type { MCPServerConfig } from '@/types/mcp';

export interface MCPServerStatus {
  name: string;
  id: string;
  status: 'connected' | 'error';
  tools: string[];
  error?: string;
}

export interface FetchMCPServerStatusOptions {
  signal?: AbortSignal;
  /**
   * True when `configs` is the full set of servers that the app can use: the server then closes
   * the other servers that it still runs. A check of one server leaves this off.
   */
  closeOthers?: boolean;
}

/**
 * Check the given servers. A check starts each local server, so the caller passes only complete
 * servers. No servers: no request, except with `closeOthers`, which then closes every server
 * that the server still runs. A failed request gives an empty list.
 */
export async function fetchMCPServerStatus(
  configs: MCPServerConfig[],
  { signal, closeOthers = false }: FetchMCPServerStatusOptions = {}
): Promise<MCPServerStatus[]> {
  if (configs.length === 0 && !closeOthers) return [];

  try {
    const response = await fetch('/api/bedrock-aisdk/mcp-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        closeOthers ? { mcpServers: configs, closeOthers } : { mcpServers: configs }
      ),
      signal,
    });

    if (!response.ok) return [];

    const data = (await response.json()) as { servers?: MCPServerStatus[] };
    return data.servers ?? [];
  } catch {
    return [];
  }
}
