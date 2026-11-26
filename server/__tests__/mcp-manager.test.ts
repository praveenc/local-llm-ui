// @vitest-environment node
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
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
  setMCPKillGraceForTests,
} from '../mcp-manager';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SLOW = fixture('slow-mcp-server.mjs');
const EXIT = fixture('exit-mcp-server.mjs');
const SILENT = fixture('silent-mcp-server.mjs');
const WRAPPER = fixture('wrapper-mcp-server.mjs');

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

const pidFile = (suffix = '') => join(tempDir, `pids${suffix}`);

/** The lines that the manager copied to the terminal */
const terminalLines = () =>
  vi.mocked(process.stderr.write).mock.calls.map((call) => String(call[0]));

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
  setMCPKillGraceForTests();
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
    // Each line also goes to the terminal, with the server name in front
    expect(process.stderr.write).toHaveBeenCalledWith('[MCP npm] npm error final line E401\n');
  }, 10_000);

  it('puts no control characters in the terminal prefix, and cuts the name', async () => {
    const name = `evil\n[MCP other] forged\x1b[2J${'n'.repeat(100)}`;
    await getMCPServerStatus([{ ...stdio('evil', [EXIT, pidFile(), 'npm']), name }]);

    const prefix = `[MCP ${`evil [MCP other] forged [2J${'n'.repeat(100)}`.slice(0, 60)}] `;
    expect(terminalLines()).toContain(`${prefix}npm error final line E401\n`);
    expect(terminalLines().every((line) => !line.slice(0, -1).includes('\n'))).toBe(true);
  }, 10_000);

  it('keeps a character whole when its bytes come in two chunks', async () => {
    await getMCPServerStatus([stdio('split', [EXIT, pidFile(), 'split'])]);

    expect(terminalLines()).toContain('[MCP split] café\n');
    expect(terminalLines().join('')).not.toContain('\uFFFD');
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

    // The close event may not have reached the manager yet: a client from the cache that
    // fails is started once more, so the check connects either way
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

  it('forgets a failed start at once, also while its process still closes', async () => {
    setMCPConnectTimeoutForTests(300);
    const config = stdio('retry', [SILENT, pidFile()]);

    // The second call comes right after the timeout, before the first process is gone
    const [first] = await getMCPServerStatus([config]);
    const second = getMCPServerStatus([config]);

    expect(first.status).toBe('error');
    expect((await second)[0].status).toBe('error');
    expect(readPids(pidFile())).toHaveLength(2);
  }, 10_000);

  it('waits for the start of an older config and keeps only the newest client', async () => {
    const older = stdio('race', [SLOW, '600', 'modern', pidFile('-older')]);
    const newer = stdio('race', [SLOW, '0', 'modern', pidFile('-newer')]);

    // The newer config starts while the older one runs, and a third call has the older one
    const [[a], [b], [c]] = await Promise.all([
      getMCPServerStatus([older]),
      getMCPServerStatus([newer]),
      getMCPServerStatus([older]),
    ]);

    expect(readPids(pidFile('-older'))).toHaveLength(1);
    expect(b).toMatchObject({ status: 'connected', tools: ['echo'] });
    // The newer start overtook the older one: the older process ends
    expect(a.error).toBe('The server settings changed while it started.');
    expect(c.error).toBe('The server settings changed while it started.');
    const [olderPid] = readPids(pidFile('-older'));
    expect(await waitFor(() => !isAlive(olderPid))).toBe(true);
    // The newer client stays in the cache
    await getMCPServerStatus([newer]);
    expect(readPids(pidFile('-newer'))).toHaveLength(1);
    expect(isAlive(readPids(pidFile('-newer'))[0])).toBe(true);
  }, 10_000);
});

describe('a server that stops right after it connected', () => {
  it('says so, and the next call starts it again', async () => {
    const config = stdio('gone', [SLOW, '0', 'modern', pidFile(), 'exit-after-connect']);

    const [status] = await getMCPServerStatus([config]);

    expect(status.error).toBe(
      'The server stopped before it answered (exit code 0). It wrote no error output.'
    );
    await getMCPServerStatus([config]);
    expect(readPids(pidFile())).toHaveLength(2);
  }, 10_000);
});

describe('a server that does not list its tools', () => {
  it('says the listing timed out and leaves no process', async () => {
    setMCPConnectTimeoutForTests(500);

    const [status] = await getMCPServerStatus([
      stdio('no-list', [SLOW, '0', 'modern', pidFile(), 'no-list']),
    ]);

    expect(status.error).toBe('The server did not list its tools in 0.5 s.');
    const [pid] = readPids(pidFile());
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
  }, 10_000);
});

describe('a server that ignores SIGTERM', () => {
  it('gets SIGKILL after the grace time', async () => {
    setMCPConnectTimeoutForTests(300);
    setMCPKillGraceForTests(300);

    const [status] = await getMCPServerStatus([
      stdio('stubborn', [SILENT, pidFile(), 'ignore-term']),
    ]);

    expect(status.error).toMatch(/^The server did not answer in 0.3 s\./);
    const [pid] = readPids(pidFile());
    expect(await waitFor(() => !isAlive(pid), 2000)).toBe(true);
  }, 10_000);
});

describe('a wrapper that starts the server as its own child, like npx', () => {
  it('leaves no process after a timeout when the wrapper passes SIGTERM on', async () => {
    setMCPConnectTimeoutForTests(500);

    const [status] = await getMCPServerStatus([
      stdio('npx-like', [WRAPPER, pidFile('-wrapper'), 'forward', SILENT, pidFile()]),
    ]);

    expect(status.error).toBe(
      'The server did not answer in 0.5 s. Last output: silent server is starting'
    );
    const pids = [...readPids(pidFile('-wrapper')), ...readPids(pidFile())];
    expect(pids).toHaveLength(2);
    expect(await waitFor(() => pids.every((pid) => !isAlive(pid)))).toBe(true);
  }, 10_000);

  it('leaves no process after a config change when the wrapper passes SIGTERM on', async () => {
    const wrapped = (mode: string, suffix: string) =>
      stdio('npx-change', [
        WRAPPER,
        pidFile(`-wrapper${suffix}`),
        'forward',
        SLOW,
        '0',
        mode,
        pidFile(suffix),
      ]);
    const [first] = await getMCPServerStatus([wrapped('modern', '-old')]);
    expect(first.status).toBe('connected');
    const oldPids = [...readPids(pidFile('-wrapper-old')), ...readPids(pidFile('-old'))];
    expect(oldPids).toHaveLength(2);

    const [second] = await getMCPServerStatus([wrapped('legacy', '-new')]);

    expect(second.status).toBe('connected');
    expect(await waitFor(() => oldPids.every((pid) => !isAlive(pid)))).toBe(true);
  }, 10_000);

  // A limit, not a goal: the SDK spawns with no process group, so the app can stop only
  // the wrapper. A wrapper that does not pass SIGTERM on leaves the server running.
  it('leaves the server running when the wrapper does not pass SIGTERM on', async () => {
    setMCPConnectTimeoutForTests(500);

    await getMCPServerStatus([
      stdio('no-forward', [WRAPPER, pidFile('-wrapper'), 'no-forward', SILENT, pidFile()]),
    ]);

    const [wrapperPid] = readPids(pidFile('-wrapper'));
    const [serverPid] = readPids(pidFile());
    expect(await waitFor(() => !isAlive(wrapperPid))).toBe(true);
    expect(isAlive(serverPid)).toBe(true);
    process.kill(serverPid, 'SIGKILL');
    expect(await waitFor(() => !isAlive(serverPid))).toBe(true);
  }, 10_000);
});

describe('which clients a check closes', () => {
  it('closes a disabled server after its check, and keeps its tools in the result', async () => {
    const config = { ...stdio('off', [SLOW, '0', 'modern', pidFile()]), enabled: false };

    const [status] = await getMCPServerStatus([config]);

    expect(status).toMatchObject({ status: 'connected', tools: ['echo'] });
    const [pid] = readPids(pidFile());
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
  }, 10_000);

  it('with closeOthers, closes a server that is no longer in the list', async () => {
    const kept = stdio('kept', [SLOW, '0', 'modern', pidFile('-kept')]);
    const removed = stdio('removed', [SLOW, '0', 'modern', pidFile('-removed')]);
    await getMCPServerStatus([kept, removed]);
    const [removedPid] = readPids(pidFile('-removed'));

    const [status] = await getMCPServerStatus([kept], { closeOthers: true });

    expect(status.status).toBe('connected');
    expect(await waitFor(() => !isAlive(removedPid))).toBe(true);
    // The kept server was reused, not started again
    expect(readPids(pidFile('-kept'))).toHaveLength(1);
    expect(isAlive(readPids(pidFile('-kept'))[0])).toBe(true);
  }, 10_000);

  it('without closeOthers, leaves the other cached servers running', async () => {
    const one = stdio('one', [SLOW, '0', 'modern', pidFile('-one')]);
    const other = stdio('other', [SLOW, '0', 'modern', pidFile('-other')]);
    await getMCPServerStatus([one, other]);

    // The Check button of one server
    await getMCPServerStatus([one]);

    const [otherPid] = readPids(pidFile('-other'));
    expect(isAlive(otherPid)).toBe(true);
    await getMCPServerStatus([other]);
    expect(readPids(pidFile('-other'))).toHaveLength(1);
  }, 10_000);
});

describe('a client that another path closes while it lists its tools', () => {
  const busy = () =>
    stdio('busy', [SLOW, '500', 'modern', pidFile(), 'slow-list', join(tempDir, 'listing')]);

  it('is not closed by the cleanup of a chat', async () => {
    const check = getMCPServerStatus([busy()]);
    expect(await waitFor(() => existsSync(join(tempDir, 'listing')))).toBe(true);

    // A chat with no MCP servers ends while the check lists the tools
    const { cleanup } = await getMCPTools([]);
    await cleanup();

    expect((await check)[0]).toMatchObject({ status: 'connected', tools: ['echo'] });
    expect(readPids(pidFile())).toHaveLength(1);
  }, 10_000);

  it('starts once more when its client was closed', async () => {
    const check = getMCPServerStatus([busy()]);
    expect(await waitFor(() => existsSync(join(tempDir, 'listing')))).toBe(true);

    await closeAllMCPClients();

    const [status] = await check;
    expect(status).toMatchObject({ status: 'connected', tools: ['echo'] });
    expect(status.error).toBeUndefined();
    expect(readPids(pidFile())).toHaveLength(2);
  }, 10_000);
});

describe('an AI SDK whose stdio transport has no process field', () => {
  it('warns once, and fails with a clear error', async () => {
    vi.spyOn(Experimental_StdioMCPTransport.prototype, 'start').mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const message =
      'The AI SDK stdio transport changed: the error output of MCP servers cannot be read.';

    const [first] = await getMCPServerStatus([stdio('changed-a', [SLOW, '0', 'modern'])]);
    const [second] = await getMCPServerStatus([stdio('changed-b', [SLOW, '0', 'modern'])]);

    expect(first.error).toBe(message);
    expect(second.error).toBe(message);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`[MCP Manager] ${message}`);
  });
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
