import { describe, expect, it } from 'vitest';

import type { MCPServerConfig, MCPServersMap } from '../../types/mcp';
import { MCP_SERVERS_CHECK_EVENT, checkableServers } from '../mcpServers';

const stdio = (id: string, patch: Partial<MCPServerConfig> = {}): MCPServerConfig =>
  ({
    id,
    name: `Server ${id}`,
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: [],
    env: {},
    ...patch,
  }) as MCPServerConfig;

const http = (id: string, url: string, enabled = true): MCPServerConfig => ({
  id,
  name: `Remote ${id}`,
  enabled,
  transport: 'http',
  url,
  headers: {},
});

const toMap = (...servers: MCPServerConfig[]): MCPServersMap =>
  Object.fromEntries(servers.map((server) => [server.id, server]));

describe('checkableServers', () => {
  it('returns nothing for no servers', () => {
    expect(checkableServers(undefined)).toEqual([]);
    expect(checkableServers({})).toEqual([]);
  });

  it('keeps complete enabled servers in the order of the map', () => {
    const a = stdio('a');
    const b = http('b', 'https://example.com/mcp');
    const c = stdio('c', { command: 'uvx' } as Partial<MCPServerConfig>);
    expect(checkableServers(toMap(a, b, c))).toEqual([a, b, c]);
  });

  it('leaves out a disabled server', () => {
    const on = stdio('on');
    const off = stdio('off', { enabled: false });
    expect(checkableServers(toMap(off, on))).toEqual([on]);
  });

  it('leaves out a server with no command or no name', () => {
    const ok = stdio('ok');
    const noCommand = stdio('no-command', { command: '  ' } as Partial<MCPServerConfig>);
    const noName = stdio('no-name', { name: '' });
    expect(checkableServers(toMap(noCommand, ok, noName))).toEqual([ok]);
  });

  it('leaves out a remote server with no URL or a broken URL', () => {
    const ok = http('ok', 'https://example.com/mcp');
    expect(checkableServers(toMap(http('empty', ''), http('bad', 'not a url'), ok))).toEqual([ok]);
  });
});

describe('MCP_SERVERS_CHECK_EVENT', () => {
  it('has a fixed name', () => {
    expect(MCP_SERVERS_CHECK_EVENT).toBe('mcp-servers-check');
  });
});
