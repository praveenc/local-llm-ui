// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import type { IncomingMessage, RequestListener, Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import { KiroAgent, KiroBusyError } from '../kiro/agent.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';
import {
  KIRO_SESSION_BUSY,
  KIRO_SESSION_NOT_FOUND,
  KIRO_SESSION_OPEN_FAILED,
  createKiroSessionsHandler,
} from '../kiro/sessions.ts';
import type { KiroSessionsAgent } from '../kiro/sessions.ts';
import { checkApiRequest } from '../security.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-kiro-acp.mjs'
);

/** The ids of the fake's session list */
const USED = 'sess_11111111-1111-4111-8111-111111111111';
const NEVER = 'sess_22222222-2222-4222-8222-222222222222';
const FAILED = 'sess_33333333-3333-4333-8333-333333333333';
const OLDER = 'sess_44444444-4444-4444-8444-444444444444';
const OLDEST = 'sess_55555555-5555-4555-8555-555555555555';
const UNKNOWN = 'sess_99999999-9999-4999-8999-999999999999';

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
  root = await mkdtemp(path.join(os.tmpdir(), 'kiro-sessions-test-'));
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
async function setup() {
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

async function post(url: string, route: string, body?: unknown) {
  const res = await fetch(`${url}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

type Summary = { sessionId: string; title: string; folder: string; status: string };
const ids = (json: Record<string, unknown>) => (json.sessions as Summary[]).map((s) => s.sessionId);

describe('POST /api/kiro/sessions', () => {
  it("lists Kiro's used sessions of the last 7 days with the folder name only", async () => {
    const c = await setup();
    const { status, text, json } = await post(c.url, '/api/kiro/sessions', {});
    expect(status).toBe(200);
    // Newest first; no never-used session, no bad id, nothing older than 7 days
    expect(ids(json)).toEqual([USED, FAILED]);
    const [used, failed] = json.sessions as Summary[];
    expect(used).toEqual({
      sessionId: USED,
      title: 'Fix the fake test',
      folder: 'fake-project',
      updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as string,
      status: 'idle',
    });
    expect(failed).toMatchObject({ folder: 'other', status: 'failed' });
    // No full path and none of Kiro's other fields (the 1 MB customAgents)
    expect(text).not.toContain('/');
    expect(text).not.toContain('customAgents');
    expect(text.length).toBeLessThan(2_000);
    const list = (await c.log()).find((m) => m.method === 'session/list');
    expect(list?.params).toEqual({});
  });

  it('takes the window from the body: 30 days, or all', async () => {
    const c = await setup();
    expect(ids((await post(c.url, '/api/kiro/sessions', { days: 30 })).json)).toEqual([
      USED,
      FAILED,
      OLDER,
    ]);
    expect(ids((await post(c.url, '/api/kiro/sessions', { days: null })).json)).toEqual([
      USED,
      FAILED,
      OLDER,
      OLDEST,
    ]);
    // An empty body is the default window
    expect(ids((await post(c.url, '/api/kiro/sessions')).json)).toEqual([USED, FAILED]);
    expect((await post(c.url, '/api/kiro/sessions', { days: 3 })).status).toBe(400);
    // One session/list for all of them: the parsed list is kept
    expect((await c.log()).filter((m) => m.method === 'session/list')).toHaveLength(1);
  });

  it('lists again after Kiro reports a change (an app reply)', async () => {
    const c = await setup();
    await post(c.url, '/api/kiro/sessions', {});
    const chat = await fetch(`${c.url}/api/kiro/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: [], seenMessages: 0, model: 'claude-fake-1', prompt: 'hi' }),
    });
    expect(await chat.text()).toContain('[DONE]');
    await post(c.url, '/api/kiro/sessions', {});
    expect((await c.log()).filter((m) => m.method === 'session/list')).toHaveLength(2);
  });

  it('answers 405 to a GET and 403 to a cross-site POST', async () => {
    const c = await setup();
    const get = await fetch(`${c.url}/api/kiro/sessions`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await fetch(`${c.url}/api/kiro/sessions/open`)).status).toBe(405);
    expect((await c.log()).some((m) => m.method === 'session/list')).toBe(false);
    for (const route of ['/api/kiro/sessions', '/api/kiro/sessions/open']) {
      const req = {
        method: 'POST',
        url: route,
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      } as unknown as IncomingMessage;
      expect(checkApiRequest(req)?.status).toBe(403);
    }
  });
});

describe('POST /api/kiro/sessions/open', () => {
  it('replays the session in its own folder, closes it, and returns the compact messages', async () => {
    const c = await setup();
    const listed = (await post(c.url, '/api/kiro/sessions', {})).json.sessions as {
      updatedAt: string;
    }[];
    const { status, json } = await post(c.url, '/api/kiro/sessions/open', { sessionId: USED });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      title: 'Replayed title',
      updatedAt: listed[0].updatedAt,
      model: { id: 'claude-fake-1', name: 'claude-fake-1' },
      turns: 2,
      imagesLeftOut: 1,
      turnsLeftOut: 0,
    });
    const messages = json.messages as { role: string; content: string; credits?: number }[];
    expect(messages.map((m) => `${m.role}: ${m.content}`)).toEqual([
      'user: Run the command',
      'assistant: Done: k7',
      'user: Say hi',
      'assistant: hi',
    ]);
    expect(messages[1]).toMatchObject({ credits: 0.12, contextPercent: 5.5, latencyMs: 4500 });
    // The update after the load answer (99 %) is not part of the reply
    expect(messages[3]).toMatchObject({ credits: 0.03, contextPercent: 6.25 });
    const log = await c.log();
    const load = log.find((m) => m.method === 'session/load');
    // The folder from Kiro's list, and no noReplay
    expect(load?.params).toEqual({ sessionId: USED, cwd: '/work/fake-project/', mcpServers: [] });
    const close = log.find((m) => m.method === 'session/close');
    expect(close?.params).toEqual({ sessionId: USED });
    expect(log.some((m) => m.method === 'session/prompt')).toBe(false);
    // The session's agent and options (K9): the config_option_update of the load is newer than
    // the options of the load answer; the model has an app control
    const options = json.sessionOptions as {
      mode: { currentValue: string };
      options: { id: string; currentValue: string }[];
    };
    expect(options.mode.currentValue).toBe('agent-b');
    expect(options.options.map((o) => `${o.id}=${o.currentValue}`)).toEqual(['autopilot=off']);
  });

  it('returns only the turns after skipTurns', async () => {
    const c = await setup();
    const { json } = await post(c.url, '/api/kiro/sessions/open', {
      sessionId: USED,
      skipTurns: 1,
    });
    expect(json.turns).toBe(2);
    expect((json.messages as { content: string }[]).map((m) => m.content)).toEqual([
      'Say hi',
      'hi',
    ]);
  });

  it('refuses a bad id, and an id that is not in the list', async () => {
    const c = await setup();
    const bad = await post(c.url, '/api/kiro/sessions/open', { sessionId: '../etc' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('The Kiro session id is not valid');
    for (const sessionId of [UNKNOWN, NEVER]) {
      const missing = await post(c.url, '/api/kiro/sessions/open', { sessionId });
      expect(missing.status).toBe(404);
      expect(missing.json.error).toBe(KIRO_SESSION_NOT_FOUND);
    }
    expect((await c.log()).some((m) => m.method === 'session/load')).toBe(false);
  });
});

describe('createKiroSessionsHandler', () => {
  const entry = (sessionId: string, title: string, updatedAt = new Date().toISOString()) => ({
    sessionId,
    cwd: '/work/project',
    title,
    updatedAt,
    _meta: { kiro: { status: 'idle' } },
  });

  function stub(overrides: Partial<KiroSessionsAgent> = {}) {
    let listener: ((method: string, params: unknown) => void) | undefined;
    const agent = {
      listSessions: vi.fn(async () => ({ sessions: [entry(USED, 'Used')] })),
      replaySession: vi.fn(async () => ({})),
      onAgentNotification: vi.fn((l: (method: string, params: unknown) => void) => {
        listener = l;
        return () => undefined;
      }),
      ...overrides,
    } as unknown as KiroSessionsAgent & {
      listSessions: ReturnType<typeof vi.fn>;
      replaySession: ReturnType<typeof vi.fn>;
    };
    return { agent, notify: (method: string) => listener?.(method, {}) };
  }

  async function handlerUrl(
    agent: KiroSessionsAgent,
    status: KiroStatus = SIGNED_IN,
    now?: () => number
  ) {
    const handler = createKiroSessionsHandler({
      agent,
      statusReader: { read: async () => status },
      now,
    });
    return serve((req, res) => {
      void (req.url === '/open' ? handler.open(req, res) : handler.list(req, res));
    });
  }

  it('keeps the list for 60 s and drops it on _kiro/sessions/changed only', async () => {
    let time = 1_000_000;
    const { agent, notify } = stub();
    const url = await handlerUrl(agent, SIGNED_IN, () => time);
    await post(url, '/list', {});
    time += 59_000;
    await post(url, '/list', {});
    expect(agent.listSessions).toHaveBeenCalledTimes(1);
    notify('_kiro/mcp/status');
    await post(url, '/list', {});
    expect(agent.listSessions).toHaveBeenCalledTimes(1);
    notify('_kiro/sessions/changed');
    await post(url, '/list', {});
    expect(agent.listSessions).toHaveBeenCalledTimes(2);
    time += 61_000;
    await post(url, '/list', {});
    expect(agent.listSessions).toHaveBeenCalledTimes(3);
  });

  it('answers 401 when Kiro is signed out, and starts nothing', async () => {
    const { agent } = stub();
    const url = await handlerUrl(agent, { state: 'signed-out', path: '~/x', version: '3.6.1' });
    for (const route of ['/list', '/open']) {
      const res = await post(url, route, route === '/open' ? { sessionId: USED } : {});
      expect(res.status).toBe(401);
      expect(res.json.code).toBe('signed-out');
    }
    expect(agent.listSessions).not.toHaveBeenCalled();
  });

  it('answers 409 while Kiro answers in the session, and a plain text for other errors', async () => {
    const { agent } = stub({
      replaySession: vi.fn(async () => {
        throw new KiroBusyError('Kiro is still answering in this chat');
      }),
    });
    const url = await handlerUrl(agent);
    const busy = await post(url, '/open', { sessionId: USED });
    expect(busy.status).toBe(409);
    expect(busy.json.error).toBe(KIRO_SESSION_BUSY);

    const failing = stub({
      replaySession: vi.fn(async () => {
        throw new Error('ENOENT: /home/someone/.kiro/sessions/x');
      }),
    });
    const failed = await post(await handlerUrl(failing.agent), '/open', { sessionId: USED });
    expect(failed.status).toBe(500);
    expect(failed.json).toEqual({ error: KIRO_SESSION_OPEN_FAILED });
  });

  it('lists again for an id that a cached list does not have yet', async () => {
    const { agent } = stub();
    agent.listSessions
      .mockResolvedValueOnce({ sessions: [entry(USED, 'Used')] })
      .mockResolvedValueOnce({ sessions: [entry(USED, 'Used'), entry(OLDER, 'Newer one')] });
    const url = await handlerUrl(agent);
    await post(url, '/list', {});
    const res = await post(url, '/open', { sessionId: OLDER });
    expect(res.status).toBe(200);
    expect(res.json.title).toBe('Newer one');
    expect(agent.replaySession).toHaveBeenCalledWith(OLDER, '/work/project', expect.any(Function));
  });
});
