// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import type { KiroProxy } from '../kiro-proxy.ts';
import { KiroAgent } from '../kiro/agent.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';
import { createKiroUsage } from '../kiro/usage.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-kiro-acp.mjs'
);

const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/.local/bin/kiro-cli',
  version: '3.6.1',
  account: { type: 'builder-id', email: 'me@example.com' },
};
const SIGNED_OUT: KiroStatus = {
  state: 'signed-out',
  path: '~/.local/bin/kiro-cli',
  version: '3.6.1',
};

const PLACEHOLDER_USAGE = {
  planName: 'KIRO POWER',
  resetDate: '2026-12-01',
  credits: { used: 1250.5, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
  overagesEnabled: true,
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('createKiroUsage', () => {
  const rawResult = {
    success: true,
    data: {
      planName: 'KIRO POWER',
      billingCycleReset: '2026-12-01',
      overagesEnabled: false,
      usageBreakdowns: [
        { resourceType: 'CREDIT', used: 5, limit: 100, percentage: 5, hasLimit: true },
      ],
    },
  };

  function setup(status: KiroStatus = SIGNED_IN) {
    const state = { status, clock: 0, result: rawResult as unknown };
    const extension = vi.fn(async () => state.result);
    const statusReader = { read: vi.fn(async () => state.status) };
    const reader = createKiroUsage({
      agent: { extension: extension as never },
      statusReader,
      ttlMs: 1000,
      now: () => state.clock,
    });
    return { state, extension, statusReader, reader };
  }

  it.each([
    [{ state: 'not-installed' } as KiroStatus],
    [{ state: 'unsupported', path: 'x', version: '2.0.0' } as KiroStatus],
    [SIGNED_OUT],
    [{ state: 'error', path: 'x', message: 'boom' } as KiroStatus],
  ])('gives null and does not call Kiro for the status %j', async (status) => {
    const c = setup(status);
    expect(await c.reader.read()).toBeNull();
    expect(c.extension).not.toHaveBeenCalled();
  });

  it('calls getUsage with empty params and parses the result', async () => {
    const c = setup();
    expect(await c.reader.read()).toMatchObject({
      planName: 'KIRO POWER',
      credits: { used: 5, limit: 100 },
    });
    expect(c.extension).toHaveBeenCalledWith('_kiro/account/getUsage', {});
  });

  it('keeps the result until the time to live ends', async () => {
    const c = setup();
    await c.reader.read();
    c.state.clock = 999;
    await c.reader.read();
    expect(c.extension).toHaveBeenCalledTimes(1);
    c.state.clock = 1000;
    await c.reader.read();
    expect(c.extension).toHaveBeenCalledTimes(2);
  });

  it('makes one call for requests that run together', async () => {
    const c = setup();
    const results = await Promise.all([c.reader.read(), c.reader.read(), c.reader.read()]);
    expect(c.extension).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it('drops the result when Kiro signs out or the account changes', async () => {
    const c = setup();
    await c.reader.read();
    c.state.status = SIGNED_OUT;
    expect(await c.reader.read()).toBeNull();
    c.state.status = SIGNED_IN;
    await c.reader.read();
    expect(c.extension).toHaveBeenCalledTimes(2);
    c.state.status = { ...SIGNED_IN, account: { type: 'builder-id', email: 'you@example.com' } };
    await c.reader.read();
    expect(c.extension).toHaveBeenCalledTimes(3);
  });

  it('gives null for an error or an unusable result, keeps nothing, and logs no account data', async () => {
    const c = setup();
    c.extension.mockRejectedValueOnce(new Error('plan KIRO POWER me@example.com'));
    expect(await c.reader.read()).toBeNull();
    c.state.result = { success: false };
    expect(await c.reader.read()).toBeNull();
    expect(c.extension).toHaveBeenCalledTimes(2);
    c.state.result = rawResult;
    expect(await c.reader.read()).not.toBeNull();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/KIRO|example\.com/);
  });

  it('gives null when the status check throws', async () => {
    const c = setup();
    c.statusReader.read.mockRejectedValueOnce(new Error('x'));
    expect(await c.reader.read()).toBeNull();
    expect(c.extension).not.toHaveBeenCalled();
  });
});

describe('POST /api/kiro/usage', () => {
  let root: string;
  let binary: string;
  let counter = 0;
  const cleanups: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'kiro-usage-test-'));
    binary = path.join(root, 'kiro-cli');
    await writeFile(
      binary,
      `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(FAKE).href)});\n`
    );
    await chmod(binary, 0o755);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(env: Record<string, string> = {}) {
    counter += 1;
    const dir = path.join(root, `case-${counter}`);
    const home = path.join(dir, 'home');
    await mkdir(home, { recursive: true });
    const logFile = path.join(dir, 'messages.log');
    const environment: KiroEnvironment = {
      env: { HOME: home, PATH: '', LOCAL_LLM_UI_KIRO_CLI: binary, FAKE_KIRO_LOG: logFile, ...env },
      home,
      platform: 'linux',
    };
    const agent = new KiroAgent({
      environment,
      stopTimings: { graceMs: 200, killMs: 1000 },
      timeouts: { cancelWait: 2000 },
    });
    const status = { current: SIGNED_IN };
    const proxy: KiroProxy = createKiroProxy({
      reader: { read: async () => status.current },
      environment,
      agent,
    });
    const server: Server = createServer((req, res) => {
      void proxy(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/kiro/usage`;
    cleanups.push(async () => {
      proxy.close();
      await agent.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const post = (body = '{}') =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const started = async () => {
      try {
        return (await readFile(logFile, 'utf8')).trim().length > 0;
      } catch {
        return false;
      }
    };
    return { status, url, post, started };
  }

  it('returns the usage of the account', async () => {
    const c = await setup({ FAKE_KIRO_USAGE: 'full' });
    const res = await c.post();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ usage: PLACEHOLDER_USAGE });
    expect(await c.started()).toBe(true);
  });

  it('gives { usage: null } when Kiro answers with an error or a result with no plan', async () => {
    for (const mode of ['error', 'bad']) {
      const c = await setup({ FAKE_KIRO_USAGE: mode });
      const res = await c.post();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ usage: null });
    }
  });

  it('gives { usage: null } and starts no Kiro process when signed out', async () => {
    const c = await setup({ FAKE_KIRO_USAGE: 'full' });
    c.status.current = SIGNED_OUT;
    const res = await c.post();
    expect(await res.json()).toEqual({ usage: null });
    expect(await c.started()).toBe(false);
  });

  it('refuses a GET without starting Kiro', async () => {
    const c = await setup({ FAKE_KIRO_USAGE: 'full' });
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await fetch(c.url, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
    expect(await c.started()).toBe(false);
  });

  it('refuses a body above the limit', async () => {
    const c = await setup({ FAKE_KIRO_USAGE: 'full' });
    const res = await c.post(JSON.stringify({ x: 'a'.repeat(4000) }));
    expect(res.status).toBe(413);
    expect(await c.started()).toBe(false);
  });
});
