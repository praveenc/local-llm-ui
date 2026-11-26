import { describe, expect, it } from 'vitest';

import type {
  MCPHTTPConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPServersMap,
  MCPStdioConfig,
} from '../../types/mcp';
import {
  MCP_SERVERS_CHECK_EVENT,
  checkableServers,
  serverConnectionKey,
  summarizeToolNames,
} from '../mcpServers';

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

const remoteConfig = (patch: Partial<MCPHTTPConfig | MCPSSEConfig> = {}): MCPServerConfig =>
  ({
    id: 'r',
    name: 'Remote r',
    enabled: true,
    transport: 'http',
    url: 'https://x.test/mcp',
    headers: {},
    ...patch,
  }) as MCPServerConfig;

describe('serverConnectionKey', () => {
  it('stays the same when the name, description, or enabled switch changes', () => {
    const base = stdio('a', { args: ['-y', 'pkg'] } as Partial<MCPServerConfig>);
    const key = serverConnectionKey(base);
    expect(serverConnectionKey({ ...base, name: 'Other' })).toBe(key);
    expect(serverConnectionKey({ ...base, description: 'x' })).toBe(key);
    expect(serverConnectionKey({ ...base, enabled: false })).toBe(key);
    expect(serverConnectionKey({ ...base, id: 'b' })).toBe(key);
  });

  it('changes with the command, the arguments, and the environment', () => {
    const base = stdio('a', { args: ['-y', 'pkg'], env: { A: '1' } } as Partial<MCPServerConfig>);
    const key = serverConnectionKey(base);
    const change = (patch: Partial<MCPStdioConfig>) =>
      serverConnectionKey({ ...base, ...patch } as MCPServerConfig);
    expect(change({ command: 'uvx' })).not.toBe(key);
    expect(change({ args: ['-y', 'pkg2'] })).not.toBe(key);
    expect(change({ args: ['pkg', '-y'] })).not.toBe(key);
    expect(change({ env: { A: '2' } })).not.toBe(key);
    expect(change({ env: {} })).not.toBe(key);
  });

  it('does not depend on the order of environment variables or headers', () => {
    const a = stdio('a', { env: { A: '1', B: '2' } } as Partial<MCPServerConfig>);
    const b = stdio('a', { env: { B: '2', A: '1' } } as Partial<MCPServerConfig>);
    expect(serverConnectionKey(a)).toBe(serverConnectionKey(b));
    expect(serverConnectionKey(remoteConfig({ headers: { A: '1', B: '2' } }))).toBe(
      serverConnectionKey(remoteConfig({ headers: { B: '2', A: '1' } }))
    );
  });

  it('changes with the URL, the headers, and the transport of a remote server', () => {
    const key = serverConnectionKey(remoteConfig());
    expect(serverConnectionKey(remoteConfig({ url: 'https://x.test/other' }))).not.toBe(key);
    expect(serverConnectionKey(remoteConfig({ headers: { A: '1' } }))).not.toBe(key);
    expect(serverConnectionKey(remoteConfig({ transport: 'sse' }))).not.toBe(key);
    expect(serverConnectionKey(remoteConfig({ enabled: false, name: 'z' }))).toBe(key);
  });

  it('treats missing headers like empty headers', () => {
    const noHeaders = remoteConfig({ headers: undefined });
    expect(serverConnectionKey(noHeaders)).toBe(serverConnectionKey(remoteConfig()));
  });

  it('does not mix a local server with a remote one', () => {
    expect(serverConnectionKey(stdio('a'))).not.toBe(
      serverConnectionKey(remoteConfig({ url: 'npx' }))
    );
  });
});

describe('summarizeToolNames', () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `tool${i + 1}`);

  it('lists all names up to the limit', () => {
    expect(summarizeToolNames(names(3))).toBe('tool1, tool2, tool3');
    expect(summarizeToolNames(names(10))).toBe(names(10).join(', '));
  });

  it('cuts after 10 names and counts the rest', () => {
    expect(summarizeToolNames(names(11))).toBe(`${names(10).join(', ')} and 1 more`);
    expect(summarizeToolNames(names(25))).toBe(`${names(10).join(', ')} and 15 more`);
  });

  it('gives an empty string for no tools', () => {
    expect(summarizeToolNames([])).toBe('');
  });
});
