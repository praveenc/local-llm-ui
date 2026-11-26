// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MCPServerConfig, MCPStdioConfig } from '../../src/types/mcp';
import {
  closeAllMCPClients,
  getMCPServerStatus,
  getMCPTools,
  setMCPConnectTimeoutForTests,
} from '../mcp-manager';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SLOW = fixture('slow-mcp-server.mjs');
const EXIT = fixture('exit-mcp-server.mjs');
const SILENT = fixture('silent-mcp-server.mjs');

/** Longer than the 1 s that the AI SDK waits for `server/discover` on stdio */
const SLOW_START_MS = 1500;

const stdio = (id: string, args: string[], env: Record<string, string> = {}): MCPStdioConfig => ({
  id,
  name: id,
  enabled: true,
  transport: 'stdio',
  command: 'node',
  args,
  env,
});

let tempDir: string;
/** Fixture processes that were still alive after a test; checked in afterAll */
const leftovers: number[] = [];

const pidFile = () => join(tempDir, 'pids');

function readPids(file: string): number[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mcp-manager-test-'));
  // The fixtures' error output is copied to the terminal; keep the test output short
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  await closeAllMCPClients();
  setMCPConnectTimeoutForTests();
  vi.restoreAllMocks();
  const pids = readdirSync(tempDir)
    .filter((name) => name.startsWith('pids'))
    .flatMap((name) => readPids(join(tempDir, name)));
  await waitFor(() => pids.every((pid) => !isAlive(pid)));
  for (const pid of pids.filter(isAlive)) {
    leftovers.push(pid);
    process.kill(pid, 'SIGKILL');
  }
  rmSync(tempDir, { recursive: true, force: true });
});

afterAll(() => {
  expect(leftovers).toEqual([]);
});

describe('getMCPServerStatus with a slow stdio server', () => {
  it('connects to a 2026-07-28 server that answers server/discover after 1 s', async () => {
    const [status] = await getMCPServerStatus([
      stdio('slow-modern', [SLOW, String(SLOW_START_MS), 'modern']),
    ]);

    expect(status).toEqual({
      name: 'slow-modern',
      id: 'slow-modern',
      status: 'connected',
      tools: ['echo'],
    });
  }, 10_000);

  it('falls back to initialize for a legacy server that rejects server/discover', async () => {
    const [status] = await getMCPServerStatus([
      stdio('slow-legacy', [SLOW, String(SLOW_START_MS), 'legacy']),
    ]);

    expect(status).toEqual({
      name: 'slow-legacy',
      id: 'slow-legacy',
      status: 'connected',
      tools: ['echo'],
    });
  }, 10_000);
});

describe('a server that stops before it answers', () => {
  it('says the exit code and shows the end of its error output', async () => {
    const [status] = await getMCPServerStatus([stdio('npm', [EXIT, pidFile(), 'npm'])]);

    expect(status.status).toBe('error');
    expect(status.error).toMatch(/^The server stopped before it answered \(exit code 1\): /);
    expect(status.error).toContain('npm error final line E401');
    expect(status.error).not.toContain('closed client');
    expect(status.error).not.toContain('Connection closed');
    // ANSI escapes stripped, empty lines dropped, only the last 6 lines kept
    expect(status.error).not.toContain('\x1b');
    expect(status.error).not.toContain('first line that the summary drops');
    expect(status.error).toContain('npm error code E401 npm error Unable to authenticate');
  }, 10_000);

  it('says when the server wrote no error output', async () => {
    const [status] = await getMCPServerStatus([stdio('quiet', [EXIT, pidFile(), 'quiet'])]);

    expect(status.error).toBe(
      'The server stopped before it answered (exit code 1). It wrote no error output.'
    );
  }, 10_000);

  it('says the signal when the server was stopped by one', async () => {
    const [status] = await getMCPServerStatus([stdio('signal', [EXIT, pidFile(), 'signal'])]);

    expect(status.error).toBe(
      'The server stopped before it answered (signal SIGTERM). It wrote no error output.'
    );
  }, 10_000);

  it('cuts long output to 400 characters', async () => {
    const [status] = await getMCPServerStatus([stdio('long', [EXIT, pidFile(), 'long'])]);
    const output = status.error!.replace(/^.*?\): /, '');

    expect(output).toHaveLength(400);
    expect(output.endsWith('…')).toBe(true);
  }, 10_000);

  it('logs the same text in getMCPTools', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tools } = await getMCPTools([stdio('npm-tools', [EXIT, pidFile(), 'npm'])]);

    expect(tools).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"npm-tools": The server stopped before it answered (exit code 1)')
    );
  }, 10_000);
});

describe('a server that stops after it connected', () => {
  it('starts again on the next status call', async () => {
    const config = stdio('recover', [SLOW, '0', 'modern', pidFile(), 'exit-after-list']);

    const [first] = await getMCPServerStatus([config]);
    expect(first.status).toBe('connected');

    const [firstPid] = readPids(pidFile());
    expect(await waitFor(() => !isAlive(firstPid))).toBe(true);
    // Let the child's close event reach the manager
    await new Promise((resolve) => setTimeout(resolve, 100));

    const [second] = await getMCPServerStatus([config]);
    expect(second).toMatchObject({ status: 'connected', tools: ['echo'] });
    expect(readPids(pidFile())).toHaveLength(2);
  }, 10_000);
});

describe('a server that never answers', () => {
  it('times out and leaves no process', async () => {
    setMCPConnectTimeoutForTests(500);

    const [status] = await getMCPServerStatus([stdio('silent', [SILENT, pidFile()])]);

    expect(status.status).toBe('error');
    expect(status.error).toBe(
      'The server did not answer in 0.5 s. Last output: silent server is starting'
    );
    const [pid] = readPids(pidFile());
    expect(pid).toBeGreaterThan(0);
    expect(await waitFor(() => !isAlive(pid), 2000)).toBe(true);
  }, 10_000);
});

describe('one start for each server', () => {
  it('starts one process for two parallel calls with the same config', async () => {
    const config = stdio('parallel', [SLOW, '300', 'modern', pidFile()]);

    const [[a], [b]] = await Promise.all([
      getMCPServerStatus([config]),
      getMCPServerStatus([config]),
    ]);

    expect(a.status).toBe('connected');
    expect(b.status).toBe('connected');
    expect(readPids(pidFile())).toHaveLength(1);
  }, 10_000);

  it('closes the old process when the config changes', async () => {
    const oldPids = join(tempDir, 'pids-old');
    await getMCPServerStatus([stdio('change', [SLOW, '0', 'modern', oldPids])]);
    const [oldPid] = readPids(oldPids);

    const [status] = await getMCPServerStatus([stdio('change', [SLOW, '0', 'legacy', pidFile()])]);

    expect(status.status).toBe('connected');
    expect(await waitFor(() => !isAlive(oldPid), 2000)).toBe(true);
  }, 10_000);

  it('tries again after a failed start', async () => {
    const config = stdio('retry', [EXIT, pidFile(), 'quiet']);

    await getMCPServerStatus([config]);
    await getMCPServerStatus([config]);

    expect(readPids(pidFile())).toHaveLength(2);
  }, 10_000);
});

describe('a command that is not found', () => {
  // The allowlist limits the commands, and which of them exist differs per host.
  // `node` exists wherever the tests run, so a PATH with only an empty folder makes
  // the spawn fail with ENOENT on every host.
  it('says the command was not found', async () => {
    const emptyDir = join(tempDir, 'empty');
    const [status] = await getMCPServerStatus([
      stdio('missing', ['server.js'], { PATH: mkdtempSync(emptyDir) }),
    ]);

    expect(status).toMatchObject({ status: 'error', error: 'Command not found: node' });
  }, 10_000);
});

describe('SEC-11 invalid config', () => {
  it('names the server and its id, and no config values', async () => {
    const config = {
      id: 'bad-id',
      name: 'Bad server',
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: 'not-an-array',
      env: { SECRET_TOKEN: 'env-secret-value' },
      headers: { Authorization: 'Bearer header-secret-value' },
    } as unknown as MCPServerConfig;

    const [status] = await getMCPServerStatus([config]);

    expect(status.error).toBe('[MCP Security] Invalid MCP config for server "Bad server" (bad-id)');
    expect(status.error).not.toContain('env-secret-value');
    expect(status.error).not.toContain('header-secret-value');
  });

  it('does not throw for a config with no name or id', async () => {
    const config = { transport: 'stdio' } as unknown as MCPServerConfig;

    const [status] = await getMCPServerStatus([config]);

    expect(status.error).toBe('[MCP Security] Invalid MCP config for server "" ()');
  });
});
