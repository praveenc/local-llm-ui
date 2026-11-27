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

  it('posts an empty list with closeOthers, so the server closes the servers that it runs', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ servers: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchMCPServerStatus([], { closeOthers: true })).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    ).toEqual({
      mcpServers: [],
      closeOthers: true,
    });
  });

  it('posts the servers as JSON and returns the status list', async () => {
    const servers = [{ id: 's1', name: 'Fetch', status: 'connected', tools: ['fetch'] }];
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ servers }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const signal = new AbortController().signal;

    expect(await fetchMCPServerStatus([server], { signal })).toEqual(servers);
    expect(fetchSpy).toHaveBeenCalledWith('/api/bedrock-aisdk/mcp-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: [server] }),
      signal,
    });
  });

  it('asks the server to close the other servers only with closeOthers', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ servers: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const body = (call: number) =>
      JSON.parse((fetchSpy.mock.calls[call] as unknown as [string, { body: string }])[1].body);

    await fetchMCPServerStatus([server], { closeOthers: true });
    await fetchMCPServerStatus([server], { closeOthers: false });

    expect(body(0)).toEqual({ mcpServers: [server], closeOthers: true });
    expect(body(1)).toEqual({ mcpServers: [server] });
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
