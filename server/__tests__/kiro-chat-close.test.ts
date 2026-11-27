// @vitest-environment node
// K7: the chat route closes the session after each reply, so that the terminal can resume it,
// and shows Kiro's own text when another program holds the session.
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
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
import { kiroListedAt } from '../kiro/chat.ts';

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
async function setup(
  extraEnv: Record<string, string> = {},
  proxyOptions: { stampWaitMs?: number } = {}
) {
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
  const proxy = createKiroProxy({
    reader: { read: async () => SIGNED_IN },
    environment,
    agent,
    ...proxyOptions,
  });
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
    home,
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

/** The session.json that the fake keeps for a session, with its `updatedAt` (K11) */
async function sessionPath(home: string, id: string): Promise<string> {
  const root = path.join(home, '.kiro', 'sessions');
  for (const bucket of await readdir(root)) {
    const file = path.join(root, bucket, id, 'session.json');
    try {
      await readFile(file);
      return file;
    } catch {
      // Not in this bucket
    }
  }
  throw new Error('no session.json');
}
async function sessionFile(home: string, id: string): Promise<{ updatedAt: string }> {
  return JSON.parse(await readFile(await sessionPath(home, id), 'utf8')) as { updatedAt: string };
}
/** A terminal turn: Kiro's time of the session moves */
async function writeSessionTime(home: string, id: string, updatedAt: string): Promise<void> {
  const file = await sessionPath(home, id);
  const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  await writeFile(file, JSON.stringify({ ...json, updatedAt }));
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
      // The list reads Kiro's time after the turn (K11)
      expect(methods.slice(-3)).toEqual(['session/prompt', 'session/list', 'session/close']);
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

  it("sends Kiro's time of a new session after the turn, before the metadata (K11)", async () => {
    const c = await setup();
    const { events, done } = await chat(c.url, { prompt: 'one' });
    expect(done).toBe(true);
    const id = sessionOf(events)!;
    // A new session has no time before the message
    expect(events.some((e) => 'sessionUpdatedBefore' in e)).toBe(false);
    const at = events.findIndex((e) => 'sessionUpdatedAt' in e);
    expect(at).toBeGreaterThan(events.findIndex((e) => 'session' in e));
    expect(at).toBeLessThan(events.findIndex((e) => 'metadata' in e));
    // The value of Kiro's list after the turn
    expect(events[at].sessionUpdatedAt).toBe((await sessionFile(c.home, id)).updatedAt);
    // Read with a list of the session's folder
    const lists = (await c.log()).filter((m) => m.method === 'session/list');
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((m) => typeof (m.params as { cwd?: unknown }).cwd === 'string')).toBe(true);
  });

  it('sends the time before the message, read after the load and before the options (K11)', async () => {
    const c = await setup();
    const first = await chat(c.url, { prompt: 'one' });
    const id = sessionOf(first.events)!;
    const afterFirst = first.events.find((e) => 'sessionUpdatedAt' in e)?.sessionUpdatedAt;
    await vi.waitFor(async () => {
      expect((await c.log()).filter((m) => m.method === 'session/close')).toHaveLength(1);
    });
    const start = (await c.log()).length;

    // An option change moves Kiro's time: the time before must be the one of the first reply
    const second = await chat(c.url, {
      sessionId: id,
      history: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'echo: one' },
      ],
      seenMessages: 2,
      prompt: 'two',
      sessionOptions: { autopilot: 'off' },
    });
    expect(errorsOf(second.events)).toEqual([]);
    const at = second.events.findIndex((e) => 'sessionUpdatedBefore' in e);
    expect(at).toBe(second.events.findIndex((e) => 'session' in e) + 1);
    expect(second.events[at].sessionUpdatedBefore).toBe(afterFirst);
    const after = second.events.find((e) => 'sessionUpdatedAt' in e)?.sessionUpdatedAt as string;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(afterFirst as string));
    expect(after).toBe((await sessionFile(c.home, id)).updatedAt);

    // The list goes out once the load has ended (the app holds the session), before the option
    const log = (await c.log()).slice(start);
    const list = log.findIndex((m) => m.method === 'session/list');
    const load = log.findIndex((m) => m.method === 'session/load');
    const option = log.findIndex((m) => m.method === 'session/set_config_option');
    expect(load).toBeGreaterThanOrEqual(0);
    expect(load).toBeLessThan(list);
    expect(list).toBeLessThan(option);
  });

  it('sends the time that a terminal turn left (K11)', async () => {
    const c = await setup();
    const first = await chat(c.url, { prompt: 'one' });
    const id = sessionOf(first.events)!;
    await vi.waitFor(async () => {
      expect((await c.log()).filter((m) => m.method === 'session/close')).toHaveLength(1);
    });
    // A turn in the terminal moves Kiro's time
    const terminal = new Date(Date.now() + 60_000).toISOString();
    await writeSessionTime(c.home, id, terminal);
    const second = await chat(c.url, {
      sessionId: id,
      history: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'echo: one' },
      ],
      seenMessages: 2,
      prompt: 'two',
    });
    expect(second.events.find((e) => 'sessionUpdatedBefore' in e)?.sessionUpdatedBefore).toBe(
      terminal
    );
  });

  it.each([
    ['slow', { FAKE_KIRO_SLOW_LIST_MS: '3000' }],
    ['failing', { FAKE_KIRO_LIST_ERROR: '1' }],
  ])('sends no times with a %s list, and the reply works (K11)', async (_name, env) => {
    // A short cap and a much slower list: the reply ends long before the list answers
    const c = await setup(env, { stampWaitMs: 200 });
    const first = await chat(c.url, { prompt: 'one' });
    const id = sessionOf(first.events)!;
    expect(first.done).toBe(true);
    await vi.waitFor(async () => {
      expect((await c.log()).filter((m) => m.method === 'session/close')).toHaveLength(1);
    });
    const started = Date.now();
    const second = await chat(c.url, {
      sessionId: id,
      history: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'echo: one' },
      ],
      seenMessages: 2,
      prompt: 'two',
    });
    expect(second.done).toBe(true);
    expect(errorsOf(second.events)).toEqual([]);
    expect(second.events.some((e) => 'content' in e)).toBe(true);
    for (const events of [first.events, second.events]) {
      expect(events.some((e) => 'sessionUpdatedBefore' in e || 'sessionUpdatedAt' in e)).toBe(
        false
      );
    }
    // At most the cap for each of the two reads (2 × 200 ms), plus the fake's short prompt: far
    // under the 3 s of one list read
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('a Stop during the wait for the time ends the reply at once (K11)', async () => {
    const c = await setup({ FAKE_KIRO_SLOW_LIST_MS: '3000' }, { stampWaitMs: 2500 });
    const first = await chat(c.url, { prompt: 'one' });
    const id = sessionOf(first.events)!;
    await vi.waitFor(
      async () => {
        expect((await c.log()).filter((m) => m.method === 'session/close')).toHaveLength(1);
      },
      { timeout: 5000 }
    );
    const start = (await c.log()).length;
    const controller = new AbortController();
    const res = await fetch(`${c.url}/api/kiro/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: [
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'echo: one' },
        ],
        seenMessages: 2,
        model: 'claude-fake-1',
        sessionId: id,
        prompt: 'two',
      }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    // The route waits for the slow list now
    await vi.waitFor(async () => {
      expect((await c.log()).slice(start).some((m) => m.method === 'session/list')).toBe(true);
    });
    const stopped = Date.now();
    controller.abort();
    // The route ends the reply without the prompt, well before the 2.5 s cap
    const ended = () =>
      vi
        .mocked(console.log)
        .mock.calls.some((call) => String(call[0]).includes('chat reply ended: cancelled'));
    await vi.waitFor(() => expect(ended()).toBe(true), { timeout: 2000, interval: 10 });
    expect(Date.now() - stopped).toBeLessThan(1000);
    expect((await c.log()).slice(start).some((m) => m.method === 'session/prompt')).toBe(false);
  }, 15_000);

  it('sends no path in any event (K11)', async () => {
    const c = await setup();
    const first = await chat(c.url, { prompt: 'one' });
    const id = sessionOf(first.events)!;
    await vi.waitFor(async () => {
      expect((await c.log()).filter((m) => m.method === 'session/close')).toHaveLength(1);
    });
    const second = await chat(c.url, {
      sessionId: id,
      history: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'echo: one' },
      ],
      seenMessages: 2,
      prompt: 'two',
    });
    expect(second.events.some((e) => 'sessionUpdatedBefore' in e)).toBe(true);
    const text = JSON.stringify([...first.events, ...second.events]);
    expect(text).not.toContain(c.home);
    expect(text).not.toContain('cwd');
    expect(second.events.find((e) => 'session' in e)?.session).toEqual({ id, created: false });
  });

  it('does not set an agent option again after a load: a change from the terminal stays', async () => {
    // The fake finds Autopilot on when it loads the closed session: the user turned it on in the terminal
    const c = await setup({ FAKE_KIRO_LOAD_AUTOPILOT: 'on' });
    const first = await chat(c.url, { prompt: 'one', sessionOptions: { autopilot: 'off' } });
    const id = sessionOf(first.events)!;
    expect(errorsOf(first.events)).toEqual([]);
    const autopilotCalls = async () =>
      (await c.log()).filter(
        (m) =>
          m.method === 'session/set_config_option' &&
          (m.params as { configId: string }).configId === 'autopilot'
      );
    expect(await autopilotCalls()).toHaveLength(1);
    await vi.waitFor(async () => {
      expect((await c.log()).filter((m) => m.method === 'session/close')).toHaveLength(1);
    });

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
    expect((await c.log()).some((m) => m.method === 'session/load')).toBe(true);
    // Still the one call from the first message: the app did not set "off" again
    expect(await autopilotCalls()).toHaveLength(1);
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

describe('kiroListedAt', () => {
  const id = 'sess_00000000-0000-4000-8000-000000000001';
  it("reads the session's time as an ISO time, and nothing else", () => {
    const sessions = [
      { sessionId: 'sess_other', cwd: '/work', updatedAt: '2026-11-26T18:00:00.000Z' },
      { sessionId: id, cwd: '/work', updatedAt: '2026-11-26T18:33:34.357+01:00' },
    ];
    expect(kiroListedAt({ sessions }, id)).toBe('2026-11-26T17:33:34.357Z');
    expect(kiroListedAt({ sessions: [] }, id)).toBeUndefined();
    expect(kiroListedAt({ sessions: [{ sessionId: id, cwd: '/work' }] }, id)).toBeUndefined();
    expect(
      kiroListedAt({ sessions: [{ sessionId: id, cwd: '/work', updatedAt: 'soon' }] }, id)
    ).toBeUndefined();
  });
});
