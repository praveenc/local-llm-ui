// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MASK, parseReadKey, shortHash } from '../../src/utils/mcpImport.ts';
import type { ScannedFile, ScannedServer } from '../../src/utils/mcpImport.ts';
import { MAX_IMPORT_FILE_BYTES, createMCPImporter } from '../mcp-import.ts';

// Every test uses a temp home folder with fixture files: never the real files of this host
let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'mcp-import-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function put(rel: string, content: unknown): Promise<void> {
  const file = path.join(home, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
}

const importer = () => createMCPImporter({ home, platform: 'linux' });

const fileOf = (files: ScannedFile[], tool: string): ScannedFile => {
  const file = files.find((f) => f.tool === tool);
  if (!file) throw new Error(`no ${tool}`);
  return file;
};

const serverOf = (file: ScannedFile, name: string): ScannedServer => {
  const server = file.servers.find((s) => s.name === name);
  if (!server) throw new Error(`no ${name}`);
  return server;
};

const SECRET = 'sk-fixture-secret-value';

describe('scan', () => {
  it('reads the fixed files of each tool with their adapters', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: {
        fetch: {
          command: 'uvx',
          args: ['mcp-server-fetch'],
          env: { API_KEY: SECRET },
          disabled: true,
          autoApprove: ['x'],
          timeout: 5,
          transport: 'stdio',
        },
        docs: { type: 'http', url: 'https://docs.example.com/mcp?token=' + SECRET },
      },
    });
    await put('.pi/agent/mcp.json', {
      mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'], toolExposure: 'all' } },
    });
    await put('.claude.json', {
      projects: { '/home/user/p': { mcpServers: { inner: { command: 'node', args: [] } } } },
      mcpServers: { local: { type: 'stdio', command: 'node', args: ['server.js'] } },
    });
    await put('.cursor/mcp.json', {
      mcpServers: { remote: { url: 'https://cursor.example.com/mcp' } },
    });
    await put('.config/Claude/claude_desktop_config.json', {
      mcpServers: { desk: { command: 'npx', args: ['-y', 'pkg'] } },
    });
    await put('.gemini/settings.json', {
      theme: 'x',
      mcpServers: {
        old: { url: 'https://gemini.example.com/sse' },
        new: { httpUrl: 'https://gemini.example.com/mcp' },
      },
    });
    await put('.config/devin/mcp_config.json', {
      mcpServers: {
        dv: { url: 'https://devin.example.com/sse', transport: 'sse' },
        dvs: { serverUrl: 'https://devin.example.com/mcp' },
      },
    });
    await put('.codeium/windsurf/mcp_config.json', {
      mcpServers: { ws: { serverUrl: 'https://windsurf.example.com/mcp' } },
    });

    const { files } = await importer().scan();
    expect(files.map((f) => f.tool)).toEqual([
      'kiro',
      'pi',
      'claude-code',
      'cursor',
      'claude-desktop',
      'gemini',
      'devin',
      'windsurf',
    ]);
    expect(files.every((f) => f.status === 'ok')).toBe(true);
    expect(fileOf(files, 'kiro').file).toBe('~/.kiro/settings/mcp.json');

    const kiroFetch = serverOf(fileOf(files, 'kiro'), 'fetch');
    expect(kiroFetch).toMatchObject({
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      envNames: ['API_KEY'],
    });
    expect(kiroFetch).not.toHaveProperty('autoApprove');
    expect(serverOf(fileOf(files, 'kiro'), 'docs')).toMatchObject({
      transport: 'http',
      url: 'https://docs.example.com/mcp',
    });
    // Claude Code: top-level mcpServers only, not the servers of each project
    expect(fileOf(files, 'claude-code').servers.map((s) => s.name)).toEqual(['local']);
    expect(serverOf(fileOf(files, 'cursor'), 'remote').transport).toBe('http');
    expect(serverOf(fileOf(files, 'gemini'), 'old').transport).toBe('sse');
    expect(serverOf(fileOf(files, 'gemini'), 'new').transport).toBe('http');
    expect(serverOf(fileOf(files, 'devin'), 'dv').transport).toBe('sse');
    expect(serverOf(fileOf(files, 'devin'), 'dvs')).toMatchObject({
      transport: 'http',
      url: 'https://devin.example.com/mcp',
    });
    expect(serverOf(fileOf(files, 'windsurf'), 'ws').url).toBe('https://windsurf.example.com/mcp');
  });

  it('uses the macOS path of Claude Desktop on macOS', async () => {
    await put('Library/Application Support/Claude/claude_desktop_config.json', {
      mcpServers: { desk: { command: 'npx', args: [] } },
    });
    const { files } = await createMCPImporter({ home, platform: 'darwin' }).scan();
    const desk = fileOf(files, 'claude-desktop');
    expect(desk.file).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
    expect(desk.servers.map((s) => s.name)).toEqual(['desk']);
  });

  it('never returns an env value, a header value, a URL query, or a masked argument', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: {
        a: {
          command: 'npx',
          args: [
            '-y',
            'pkg',
            '--api-key',
            SECRET,
            `--token=${SECRET}`,
            `https://x.example/?k=${SECRET}`,
            `--url=https://h.example/sse?api_key=${SECRET}`,
            `wss://h.example/x?token=${SECRET}`,
            `--target=ws://u:${SECRET}@h.example/x#${SECRET}`,
            '-e',
            `GITHUB_PERSONAL_ACCESS_TOKEN=${SECRET}`,
            '--env',
            `OTHER=${SECRET}`,
            '--header',
            `Authorization: Bearer ${SECRET}`,
            `--header=X-Api: ${SECRET}`,
            '-token',
            SECRET,
          ],
          env: { TOKEN: SECRET },
        },
        b: {
          type: 'sse',
          url: `https://user:${SECRET}@remote.example.com/sse?key=${SECRET}#${SECRET}`,
          headers: { Authorization: `Bearer ${SECRET}` },
        },
      },
    });
    const scan = await importer().scan();
    const text = JSON.stringify(scan);
    expect(text).not.toContain(SECRET);
    const kiro = fileOf(scan.files, 'kiro');
    expect(serverOf(kiro, 'a').args).toEqual([
      '-y',
      'pkg',
      '--api-key',
      MASK,
      `--token=${MASK}`,
      'https://x.example/',
      '--url=https://h.example/sse',
      'wss://h.example/x',
      '--target=ws://h.example/x',
      '-e',
      `GITHUB_PERSONAL_ACCESS_TOKEN=${MASK}`,
      '--env',
      `OTHER=${MASK}`,
      '--header',
      `Authorization: ${MASK}`,
      `--header=X-Api: ${MASK}`,
      '-token',
      MASK,
    ]);
    expect(serverOf(kiro, 'b')).toMatchObject({
      url: 'https://remote.example.com/sse',
      headerNames: ['Authorization'],
    });
  });

  it('says too large for a file over 4 MB, and could not read for bad JSON or a folder', async () => {
    await put('.claude.json', '');
    await truncate(path.join(home, '.claude.json'), MAX_IMPORT_FILE_BYTES + 1);
    await put('.pi/agent/mcp.json', '{ "mcpServers": { "a": { "command": "x", }, } }');
    await mkdir(path.join(home, 'folder'));
    await mkdir(path.join(home, '.kiro/settings'), { recursive: true });
    await symlink(path.join(home, 'folder'), path.join(home, '.kiro/settings/mcp.json'));

    const { files } = await importer().scan();
    expect(fileOf(files, 'claude-code')).toMatchObject({ status: 'too-large', servers: [] });
    expect(fileOf(files, 'pi')).toMatchObject({ status: 'unreadable', servers: [] });
    expect(fileOf(files, 'kiro')).toMatchObject({ status: 'unreadable', servers: [] });
    expect(fileOf(files, 'cursor').status).toBe('missing');
  });

  it('follows a symlink to a regular file', async () => {
    await put('dotfiles/kiro.json', { mcpServers: { linked: { command: 'node', args: [] } } });
    await mkdir(path.join(home, '.kiro/settings'), { recursive: true });
    await symlink(
      path.join(home, 'dotfiles/kiro.json'),
      path.join(home, '.kiro/settings/mcp.json')
    );
    const { files } = await importer().scan();
    expect(fileOf(files, 'kiro').servers.map((s) => s.name)).toEqual(['linked']);
  });

  it('skips __proto__, constructor, and empty names', async () => {
    await put(
      '.kiro/settings/mcp.json',
      '{"mcpServers":{"__proto__":{"command":"node"},"constructor":{"command":"node"},"":{"command":"node"},"ok":{"command":"node","env":{"__proto__":"x","A":"1"}}}}'
    );
    const { files } = await importer().scan();
    const kiro = fileOf(files, 'kiro');
    expect(kiro.servers.map((s) => s.name)).toEqual(['ok']);
    expect(kiro.servers[0].envNames).toEqual(['A']);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('marks servers that cannot run, with the reason', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: {
        relative: { command: './bin/server' },
        shell: { command: 'node', args: ['a;b'] },
        placeholder: { command: 'node', args: ['${workspaceFolder}/x'] },
        loopback: { url: 'http://127.0.0.1:9000/mcp' },
        broken: { url: 'not a url' },
        odd: { command: 5 },
      },
    });
    const kiro = fileOf((await importer().scan()).files, 'kiro');
    expect(serverOf(kiro, 'relative').blocked).toMatch(/full path/);
    expect(serverOf(kiro, 'shell').blocked).toBe(
      'Argument 1 contains characters that the app does not allow'
    );
    expect(serverOf(kiro, 'placeholder').blocked).toMatch(/\$\{…\}/);
    expect(serverOf(kiro, 'loopback').blocked).toMatch(/Localhost/);
    expect(serverOf(kiro, 'broken').blocked).toBe('The URL is not valid');
    expect(serverOf(kiro, 'odd').blocked).toBe('The app cannot read this entry');
  });

  it('counts placeholders in env values, URLs, and header values', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: {
        a: { command: 'node', env: { A: '${env:A}', B: '$HOME/x', C: 'plain' } },
        b: { url: 'https://x.example/${PATH_PART}', headers: { H: 'Bearer ${TOKEN}' } },
      },
    });
    const kiro = fileOf((await importer().scan()).files, 'kiro');
    expect(serverOf(kiro, 'a').placeholders).toBe(2);
    expect(serverOf(kiro, 'b').placeholders).toBe(2);
  });

  it('writes a command in the home folder as ~/ for the same-server key', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: { a: { command: path.join(home, 'bin/server') } },
    });
    const scan = await importer().scan();
    const a = serverOf(fileOf(scan.files, 'kiro'), 'a');
    expect(a.commandKey).toBe('~/bin/server');
    // No home path in the scan: the command is the ~/ form too, and the home is a hash only
    expect(a.command).toBe('~/bin/server');
    expect(JSON.stringify(scan)).not.toContain(home);
    expect(scan.homeHash).toBe(shortHash(`${home}/`));
  });

  it('writes path arguments in the home folder as ~/ in the scan, and read returns them real', async () => {
    const notes = path.join(home, 'notes');
    await put('.kiro/settings/mcp.json', {
      mcpServers: {
        fs: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', notes, `--root=${notes}`],
        },
      },
    });
    const imp = importer();
    const scan = await imp.scan();
    const fs = serverOf(fileOf(scan.files, 'kiro'), 'fs');
    expect(fs.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '~/notes',
      '--root=~/notes',
    ]);
    expect(JSON.stringify(scan)).not.toContain(home);
    const result = await imp.read([fs.key]);
    expect(result.servers).toHaveLength(1);
    const config = result.servers[0].config;
    expect(config.transport === 'stdio' && config.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      notes,
      `--root=${notes}`,
    ]);
  });

  it('sends no home hash and no ~/ form when the home folder is /', async () => {
    const scan = await createMCPImporter({ home: '/', platform: 'linux' }).scan();
    expect(scan.homeHash).toBeUndefined();
  });

  it('gives each read buffer the size of its file, not 4 MB', async () => {
    await put('.kiro/settings/mcp.json', { mcpServers: { a: { command: 'node' } } });
    const alloc = vi.spyOn(Buffer, 'alloc');
    try {
      await importer().scan();
      const sizes = alloc.mock.calls.map(([size]) => size);
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.max(...sizes)).toBeLessThan(1024);
    } finally {
      alloc.mockRestore();
    }
  });
});

describe('read', () => {
  it('returns values only for the selected keys, off', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: {
        a: { command: 'npx', args: ['--api-key', SECRET], env: { TOKEN: SECRET }, disabled: false },
        b: { command: 'node', env: { OTHER: 'other-secret' } },
      },
    });
    const imp = importer();
    const kiro = fileOf((await imp.scan()).files, 'kiro');
    const result = await imp.read([serverOf(kiro, 'a').key]);
    expect(result.skipped).toEqual([]);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].config).toMatchObject({
      name: 'a',
      enabled: false,
      transport: 'stdio',
      command: 'npx',
      args: ['--api-key', SECRET],
      env: { TOKEN: SECRET },
    });
    expect(JSON.stringify(result)).not.toContain('other-secret');
  });

  it('skips a server that changed or is gone', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: { a: { command: 'node', args: ['one'] }, b: { command: 'node' } },
    });
    const imp = importer();
    const kiro = fileOf((await imp.scan()).files, 'kiro');
    const keyA = serverOf(kiro, 'a').key;
    const keyB = serverOf(kiro, 'b').key;
    await put('.kiro/settings/mcp.json', { mcpServers: { a: { command: 'node', args: ['two'] } } });
    const result = await imp.read([keyA, keyB, 'nope']);
    expect(result.servers).toEqual([]);
    expect(result.skipped.map((s) => s.key)).toEqual([keyA, keyB, 'nope']);
    expect(result.skipped[0].reason).toMatch(/changed/);
    expect(result.skipped[1].reason).toMatch(/no longer/);
  });

  it('does not return a server that cannot run', async () => {
    await put('.kiro/settings/mcp.json', {
      mcpServers: { a: { command: 'node', args: ['$(x)'] } },
    });
    const imp = importer();
    const key = serverOf(fileOf((await imp.scan()).files, 'kiro'), 'a').key;
    const result = await imp.read([key]);
    expect(result.servers).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/\$\{…\}|characters/);
  });

  it('builds keys from the tool, a revision, and the name', async () => {
    await put('.pi/agent/mcp.json', { mcpServers: { 'a:b': { command: 'node' } } });
    const key = fileOf((await importer().scan()).files, 'pi').servers[0].key;
    expect(parseReadKey(key)).toMatchObject({ tool: 'pi', name: 'a:b' });
  });
});
