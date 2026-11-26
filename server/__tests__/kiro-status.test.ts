// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import { displayPath } from '../kiro/binary.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';
import { createKiroStatusReader } from '../kiro/status.ts';

// A fake kiro-cli. Behavior comes from the FAKE_* variables; each run logs its arguments.
const FAKE_SCRIPT = `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, args.join(' ') + '\\n');
if (args[0] === '--version') {
  if (process.env.FAKE_VERSION_SLEEP) {
    setTimeout(() => {}, Number(process.env.FAKE_VERSION_SLEEP));
  } else {
    process.stdout.write(process.env.FAKE_VERSION ?? 'kiro-cli 3.5.0\\n');
  }
} else if (args[0] === 'whoami') {
  process.stdout.write(process.env.FAKE_WHOAMI ?? '');
  process.exitCode = Number(process.env.FAKE_WHOAMI_CODE ?? 0);
}
`;

const SIGNED_IN =
  '{"accountType":"IamIdentityCenter","startUrl":"https://x.awsapps.com/start","region":"us-east-1","email":"me@example.com"}\nLogged in with IAM Identity Center\n';

let root: string;
let counter = 0;
const cleanup: string[] = [];

async function fakeBinary(dir: string, mode = 0o755): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'kiro-cli');
  await writeFile(file, FAKE_SCRIPT);
  await chmod(file, mode);
  return file;
}

async function freshDir(): Promise<string> {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

interface Setup {
  environment: KiroEnvironment;
  home: string;
  binDir: string;
  log: string;
}

async function setup(env: Record<string, string> = {}, withBinary = true): Promise<Setup> {
  const dir = await freshDir();
  const home = path.join(dir, 'home');
  const binDir = path.join(dir, 'bin');
  await mkdir(home, { recursive: true });
  const log = path.join(dir, 'runs.log');
  if (withBinary) await fakeBinary(binDir);
  return {
    home,
    binDir,
    log,
    environment: {
      env: { PATH: withBinary ? binDir : '', HOME: home, FAKE_LOG: log, ...env },
      home,
      platform: 'linux',
    },
  };
}

async function runs(log: string): Promise<string[]> {
  try {
    return (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kiro-status-'));
  cleanup.push(root);
});

afterAll(async () => {
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('kiro binary lookup', () => {
  it('reports not-installed when kiro-cli is nowhere', async () => {
    const s = await setup({}, false);
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toEqual({ state: 'not-installed' });
  });

  it('finds kiro-cli on PATH and shows the path', async () => {
    const s = await setup({ FAKE_WHOAMI: '{"account":null}', FAKE_WHOAMI_CODE: '1' });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status.state).toBe('signed-out');
    expect(status).toMatchObject({ path: path.join(s.binDir, 'kiro-cli') });
  });

  it('prefers ~/.local/bin over PATH and writes the home folder as ~', async () => {
    const s = await setup({ FAKE_WHOAMI: '{"account":null}', FAKE_WHOAMI_CODE: '1' });
    await fakeBinary(path.join(s.home, '.local', 'bin'));
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({ state: 'signed-out', path: '~/.local/bin/kiro-cli' });
  });

  it('prefers LOCAL_LLM_UI_KIRO_CLI over everything', async () => {
    const s = await setup({ FAKE_WHOAMI: '{"account":null}', FAKE_WHOAMI_CODE: '1' });
    await fakeBinary(path.join(s.home, '.local', 'bin'));
    await fakeBinary(path.join(s.home, 'custom'));
    s.environment.env.LOCAL_LLM_UI_KIRO_CLI = '~/custom/kiro-cli';
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({ state: 'signed-out', path: '~/custom/kiro-cli' });
  });

  it('gives an error for an invalid LOCAL_LLM_UI_KIRO_CLI and does not fall back', async () => {
    const s = await setup();
    s.environment.env.LOCAL_LLM_UI_KIRO_CLI = path.join(s.home, 'missing', 'kiro-cli');
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status.state).toBe('error');
    expect(status).toMatchObject({
      message: `LOCAL_LLM_UI_KIRO_CLI is set to ${s.environment.env.LOCAL_LLM_UI_KIRO_CLI}, which is not an executable file`,
    });
    expect(await runs(s.log)).toEqual([]);
  });

  it('rejects a relative LOCAL_LLM_UI_KIRO_CLI', async () => {
    const s = await setup();
    s.environment.env.LOCAL_LLM_UI_KIRO_CLI = 'kiro-cli';
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status.state).toBe('error');
  });

  it('skips a file that is not executable', async () => {
    const s = await setup({}, false);
    await fakeBinary(s.binDir, 0o644);
    s.environment.env.PATH = `relative/dir::${s.binDir}`;
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toEqual({ state: 'not-installed' });
  });

  it('reports not-installed on Windows', async () => {
    const s = await setup();
    const status = await createKiroStatusReader({
      environment: { ...s.environment, platform: 'win32' },
    }).read();
    expect(status).toEqual({ state: 'not-installed' });
  });

  it('writes only a real home prefix as ~', () => {
    expect(displayPath('/home/a/bin/x', '/home/a')).toBe('~/bin/x');
    expect(displayPath('/home/ab/bin/x', '/home/a')).toBe('/home/ab/bin/x');
    expect(displayPath('/usr/bin/x', '/home/a')).toBe('/usr/bin/x');
  });
});

describe('kiro status', () => {
  it('reports unsupported for Kiro CLI 2 and does not run whoami', async () => {
    const s = await setup({ FAKE_VERSION: 'kiro-cli 2.37.1\n' });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({ state: 'unsupported', version: '2.37.1' });
    expect(await runs(s.log)).toEqual(['--version']);
  });

  it('reports signed-out', async () => {
    const s = await setup({ FAKE_WHOAMI: '{"account":null}\n', FAKE_WHOAMI_CODE: '1' });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({ state: 'signed-out', version: '3.5.0' });
    expect(await runs(s.log)).toEqual(['--version', 'whoami -f json']);
  });

  it('reports signed-in with the email', async () => {
    const s = await setup({ FAKE_WHOAMI: SIGNED_IN });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({
      state: 'signed-in',
      version: '3.5.0',
      account: { type: 'identity-center', email: 'me@example.com' },
    });
  });

  it('reports an API key without an email', async () => {
    const s = await setup({ FAKE_WHOAMI: '{"accountType":"ApiKey","email":null}\n' });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({ state: 'signed-in', account: { type: 'api-key' } });
    expect((status as Extract<KiroStatus, { state: 'signed-in' }>).account.email).toBeUndefined();
  });

  it('gives an error for a version that it cannot read', async () => {
    const s = await setup({ FAKE_VERSION: 'something odd\n' });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({
      state: 'error',
      message: 'Could not read the version: something odd',
    });
  });

  it('gives an error for whoami output that it cannot read', async () => {
    const s = await setup({ FAKE_WHOAMI: 'not json\n' });
    const status = await createKiroStatusReader({ environment: s.environment }).read();
    expect(status).toMatchObject({
      state: 'error',
      message: 'Could not read the sign-in state: not json',
    });
  });

  it('gives an error when the version command times out', async () => {
    const s = await setup({ FAKE_VERSION_SLEEP: '10000' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const status = await createKiroStatusReader({
        environment: s.environment,
        timeouts: { versionMs: 300 },
      }).read();
      expect(status.state).toBe('error');
      expect((status as Extract<KiroStatus, { state: 'error' }>).message).toMatch(/timed out/);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[kiro]'));
    } finally {
      warn.mockRestore();
    }
  });

  it('does not log the email', async () => {
    const s = await setup({ FAKE_WHOAMI: SIGNED_IN });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await createKiroStatusReader({ environment: s.environment }).read();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('kiro status cache', () => {
  it('runs kiro-cli once for two reads, and again for a refresh', async () => {
    const s = await setup({ FAKE_WHOAMI: SIGNED_IN });
    let time = 1000;
    const reader = createKiroStatusReader({ environment: s.environment, now: () => time });
    await reader.read();
    await reader.read();
    expect(await runs(s.log)).toHaveLength(2); // --version + whoami
    await reader.read(true);
    expect(await runs(s.log)).toHaveLength(4);
    time += 31_000;
    await reader.read();
    expect(await runs(s.log)).toHaveLength(6);
  });

  it('shares one run between concurrent reads, also with refresh', async () => {
    const s = await setup({ FAKE_WHOAMI: SIGNED_IN });
    const reader = createKiroStatusReader({ environment: s.environment });
    const results = await Promise.all([reader.read(), reader.read(true), reader.read()]);
    expect(results[0]).toBe(results[1]);
    expect(await runs(s.log)).toHaveLength(2);
  });
});

describe('/api/kiro route', () => {
  let server: Server;
  let base: string;
  const calls: Array<boolean | undefined> = [];
  const status: KiroStatus = { state: 'not-installed' };
  const folder = { path: '~/projects/demo', isDefault: false };
  // A stub, so that the route does not read the settings file of the real home folder
  const settings = {
    folder: async () => folder,
    workspaceDir: async () => undefined,
    set: async () => ({ ok: true as const, folder }),
  };

  beforeAll(async () => {
    const proxy = createKiroProxy({
      reader: {
        read: async (refresh) => {
          calls.push(refresh);
          return status;
        },
      },
      settings,
    });
    server = createServer((req, res) => {
      void proxy(req, res, () => {
        res.statusCode = 418;
        res.end('next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns the status as JSON that is not cached', async () => {
    const response = await fetch(`${base}/api/kiro/status`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    // The folder for new Kiro chats, for display (D6)
    expect(await response.json()).toEqual({ ...status, folder });
    expect(calls.at(-1)).toBe(false);
  });

  it('passes refresh=1 to the reader', async () => {
    await fetch(`${base}/api/kiro/status?refresh=1`);
    expect(calls.at(-1)).toBe(true);
  });

  it('answers HEAD', async () => {
    const response = await fetch(`${base}/api/kiro/status`, { method: 'HEAD' });
    expect(response.status).toBe(200);
  });

  it('rejects other methods with 405', async () => {
    const response = await fetch(`${base}/api/kiro/status`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });

  it('gives 404 for another /api/kiro path', async () => {
    const response = await fetch(`${base}/api/kiro/other`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('passes other paths to next()', async () => {
    const response = await fetch(`${base}/api/other`);
    expect(response.status).toBe(418);
  });

  it('gives 500 when the reader throws', async () => {
    const failing = createKiroProxy({
      reader: {
        read: async () => {
          throw new Error('boom');
        },
      },
      // The stub of this block: never the settings file of the real home folder
      settings,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failServer = createServer((req, res) => void failing(req, res, () => res.end()));
    await new Promise<void>((resolve) => failServer.listen(0, '127.0.0.1', resolve));
    try {
      const port = (failServer.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/kiro/status`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal server error' });
    } finally {
      await new Promise<void>((resolve) => failServer.close(() => resolve()));
      warn.mockRestore();
    }
  });
});
