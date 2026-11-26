// @vitest-environment node
// K7: the chat route closes the session after each reply, so that the terminal can resume it,
// and shows Kiro's own text when another program holds the session.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import type { RequestListener, Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import { KiroAgent } from '../kiro/agent.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-kiro-acp.mjs'
);

const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/.local/bin/kiro-cli',
  version: '3.6.1',
  account: { type: 'builder-id', email: 'you@example.com' },
};

let root: string;
let binary: string;
let counter = 0;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kiro-chat-close-test-'));
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

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function serve(handler: RequestListener): Promise<string> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The proxy with a real KiroAgent on the fake kiro-cli */
async function setup(extraEnv: Record<string, string> = {}) {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  const home = path.join(dir, 'home');
  await mkdir(home, { recursive: true });
  const logFile = path.join(dir, 'messages.log');
  const environment: KiroEnvironment = {
    env: {
      HOME: home,
      PATH: '',
      LOCAL_LLM_UI_KIRO_CLI: binary,
      FAKE_KIRO_LOG: logFile,
      FAKE_KIRO_CHAT: '1',
      FAKE_KIRO_SESSIONS: '1',
      ...extraEnv,
    },
    home,
    platform: 'linux',
  };
  const agent = new KiroAgent({ environment, stopTimings: { graceMs: 200, killMs: 1000 } });
  const proxy = createKiroProxy({ reader: { read: async () => SIGNED_IN }, environment, agent });
  const url = await serve((req, res) => {
    void proxy(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  cleanups.push(async () => {
    proxy.close();
    await agent.stop();
  });
  return {
    url,
    async log(): Promise<Record<string, unknown>[]> {
      try {
        return (await readFile(logFile, 'utf8'))
          .split('\n')
          .filter(Boolean)
          .map((l) => (JSON.parse(l) as { msg: Record<string, unknown> }).msg);
      } catch {
        return [];
      }
    },
  };
}

type Event = Record<string, unknown>;

async function chat(url: string, body: Record<string, unknown>) {
  const res = await fetch(`${url}/api/kiro/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history: [], seenMessages: 0, model: 'claude-fake-1', ...body }),
  });
  const text = await res.text();
  const events = text
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data: ') && b !== 'data: [DONE]')
    .map((b) => JSON.parse(b.slice(6)) as Event);
  return { events, done: text.includes('data: [DONE]') };
}

const sessionOf = (events: Event[]) =>
  (events.find((e) => 'session' in e)?.session as { id: string } | undefined)?.id;
const errorsOf = (events: Event[]) => events.filter((e) => 'error' in e).map((e) => e.error);

describe('POST /api/kiro/chat and session/close', () => {
  it('closes the session after the reply; the next message loads it with the same options', async () => {
    const c = await setup();
    const first = await chat(c.url, { prompt: 'one' });
    const id = sessionOf(first.events)!;
    expect(first.done).toBe(true);
    // The close runs after the reply has ended
    let log: Record<string, unknown>[] = [];
    await vi.waitFor(async () => {
      log = await c.log();
      const methods = log.map((m) => String(m.method)).filter((m) => m.startsWith('session/'));
      expect(methods.slice(-2)).toEqual(['session/prompt', 'session/close']);
    });
    expect(log.at(-1)?.params).toEqual({ sessionId: id });

    const second = await chat(c.url, {
      sessionId: id,
      history: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'echo: one' },
      ],
      seenMessages: 2,
      prompt: 'two',
    });
    expect(errorsOf(second.events)).toEqual([]);
    expect(sessionOf(second.events)).toBe(id);
    await vi.waitFor(async () => {
      log = await c.log();
      expect(log.filter((m) => m.method === 'session/close')).toHaveLength(2);
    });
    const load = log.find((m) => m.method === 'session/load');
    expect(load?.params).toMatchObject({ sessionId: id, _meta: { kiro: { noReplay: true } } });
    // Kiro kept the model: the app does not set it again
    const models = log.filter(
      (m) =>
        m.method === 'session/set_config_option' &&
        (m.params as { configId: string }).configId === 'model'
    );
    expect(models).toHaveLength(1);
    expect(log.filter((m) => m.method === 'session/close')).toHaveLength(2);
  });

  it("shows Kiro's lease text when another program holds the session, and does not close it", async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'lease' });
    const { events, done } = await chat(c.url, { prompt: 'hello' });
    expect(errorsOf(events)).toEqual([
      'This session is loaded in another program, Fake Terminal (pid 4242), which owns its execution. Close the session there to drive it from here.',
    ]);
    expect(done).toBe(true);
    expect((await c.log()).some((m) => m.method === 'session/close')).toBe(false);
  });
});
