import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MCPServerConfig } from '@/types/mcp';

import { fetchMCPServerStatus } from '../mcpStatus';

const server: MCPServerConfig = {
  id: 's1',
  name: 'Fetch',
  enabled: true,
  transport: 'stdio',
  command: 'uvx',
  args: ['mcp-server-fetch'],
  env: {},
};

afterEach(() => vi.unstubAllGlobals());

describe('fetchMCPServerStatus', () => {
  it('sends no request for no servers', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchMCPServerStatus([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the servers as JSON and returns the status list', async () => {
    const servers = [{ id: 's1', name: 'Fetch', status: 'connected', tools: ['fetch'] }];
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ servers }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const signal = new AbortController().signal;

    expect(await fetchMCPServerStatus([server], signal)).toEqual(servers);
    expect(fetchSpy).toHaveBeenCalledWith('/api/bedrock-aisdk/mcp-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: [server] }),
      signal,
    });
  });

  it('returns an empty list for an answer that is not OK, and for a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }))
    );
    expect(await fetchMCPServerStatus([server])).toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    expect(await fetchMCPServerStatus([server])).toEqual([]);
  });
});
