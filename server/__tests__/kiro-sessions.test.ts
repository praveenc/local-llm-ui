// @vitest-environment node
import { createHash } from 'crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import type { IncomingMessage, RequestListener, Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIRO_COUNT_ONLY_SKIP } from '../../src/utils/kiroSessions.ts';
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
    // The full lists only: the chat route reads one folder for Kiro's time (K11)
    const full = (await c.log()).filter(
      (m) =>
        m.method === 'session/list' && (m.params as { cwd?: string } | undefined)?.cwd === undefined
    );
    expect(full).toHaveLength(2);
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

  it('answers a count-only open with no messages and all the turns (D24)', async () => {
    const c = await setup();
    const { json } = await post(c.url, '/api/kiro/sessions/open', {
      sessionId: USED,
      skipTurns: KIRO_COUNT_ONLY_SKIP,
    });
    expect(json.turns).toBe(2);
    expect(json.messages).toEqual([]);
    expect(json.turnsLeftOut).toBe(0);
    expect(typeof json.updatedAt).toBe('string');
  });

  it("gives the same time as the chat route, and Kiro's time now, not the cached one (K11)", async () => {
    const c = await setup();
    const res = await fetch(`${c.url}/api/kiro/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: [], seenMessages: 0, model: 'claude-fake-1', prompt: 'hi' }),
    });
    const events = (await res.text())
      .split('\n\n')
      .map((b) => b.trim())
      .filter((b) => b.startsWith('data: ') && b !== 'data: [DONE]')
      .map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
    const id = (events.find((e) => 'session' in e)?.session as { id: string }).id;
    const chatAt = events.find((e) => 'sessionUpdatedAt' in e)?.sessionUpdatedAt as string;
    expect(typeof chatAt).toBe('string');
    await vi.waitFor(async () => {
      expect((await c.log()).some((m) => m.method === 'session/close')).toBe(true);
    });
    // The full list has the session with the same time as the list of its folder
    const listed = (await post(c.url, '/api/kiro/sessions', {})).json.sessions as {
      sessionId: string;
      updatedAt: string;
    }[];
    expect(listed.find((s) => s.sessionId === id)?.updatedAt).toBe(chatAt);
    const opened = await post(c.url, '/api/kiro/sessions/open', { sessionId: id });
    expect(opened.status).toBe(200);
    expect(opened.json.updatedAt).toBe(chatAt);

    // A terminal turn: the cached list is now old, the open reports Kiro's time
    const root = path.join(c.home, '.kiro', 'sessions');
    const [bucket] = (await readdir(root)).filter((b) => b);
    const file = path.join(root, bucket, id, 'session.json');
    const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    const terminal = new Date(Date.parse(chatAt) + 60_000).toISOString();
    await writeFile(file, JSON.stringify({ ...json, updatedAt: terminal }));
    const cachedAt = (
      (await post(c.url, '/api/kiro/sessions', {})).json.sessions as {
        sessionId: string;
        updatedAt: string;
      }[]
    ).find((s) => s.sessionId === id)?.updatedAt;
    expect(cachedAt).toBe(chatAt);
    const again = await post(c.url, '/api/kiro/sessions/open', { sessionId: id });
    expect(again.json.updatedAt).toBe(terminal);
    // The time is read with a list of the session's folder; no folder goes to the browser
    const lists = (await c.log()).filter((m) => m.method === 'session/list');
    expect(lists.some((m) => typeof (m.params as { cwd?: unknown }).cwd === 'string')).toBe(true);
    expect(again.text).not.toContain(c.home);
    expect(again.text).not.toContain('cwd');
  });

  /** A session.json for a session of the fake's list, as Kiro keeps it on disk */
  async function sessionFile(home: string, sessionId: string, cwd: string) {
    const bucket = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
    const dir = path.join(home, '.kiro', 'sessions', bucket, sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'session.json'),
      JSON.stringify({ id: sessionId, workspacePaths: [cwd], title: 'On disk' })
    );
  }
  const loads = (log: Record<string, unknown>[]) =>
    log.filter((m) => m.method === 'session/load').length;
  const fullLists = (log: Record<string, unknown>[]) =>
    log.filter(
      (m) =>
        m.method === 'session/list' && (m.params as { cwd?: string } | undefined)?.cwd === undefined
    ).length;

  it("answers unchanged with no load when Kiro's time equals ifUpdatedAfter (K11 B4)", async () => {
    const c = await setup();
    await sessionFile(c.home, USED, '/work/fake-project/');
    // Newer than the chat's time: the replay, from the folder list, with no full list
    const replayed = await post(c.url, '/api/kiro/sessions/open', {
      sessionId: USED,
      skipTurns: 1,
      ifUpdatedAfter: '2020-01-01T00:00:00.000Z',
    });
    expect(replayed.status).toBe(200);
    expect(replayed.json.turns).toBe(2);
    expect((replayed.json.messages as { content: string }[]).map((m) => m.content)).toEqual([
      'Say hi',
      'hi',
    ]);
    let log = await c.log();
    expect(loads(log)).toBe(1);
    expect(fullLists(log)).toBe(0);
    const at = replayed.json.updatedAt as string;
    // The exact time: the same as the full list reports
    const listed = (await post(c.url, '/api/kiro/sessions', {})).json.sessions as {
      sessionId: string;
      updatedAt: string;
    }[];
    expect(listed.find((s) => s.sessionId === USED)?.updatedAt).toBe(at);

    // The same instant: unchanged, and no load
    const same = await post(c.url, '/api/kiro/sessions/open', {
      sessionId: USED,
      skipTurns: 2,
      ifUpdatedAfter: at,
    });
    expect(same.status).toBe(200);
    expect(same.json).toEqual({ unchanged: true, updatedAt: at });
    log = await c.log();
    expect(loads(log)).toBe(1);
    expect(same.text).not.toContain('/work');
    expect(same.text).not.toContain(c.home);
    expect(replayed.text).not.toContain('/work');
    expect(replayed.text).not.toContain('cwd');
  });

  it('answers 404 with no load for an id that has no session.json, or a bad ifUpdatedAfter 400', async () => {
    const c = await setup();
    // OLDER is in Kiro's full list, but has no session.json: no load of an id from elsewhere
    for (const sessionId of [OLDER, UNKNOWN]) {
      const res = await post(c.url, '/api/kiro/sessions/open', {
        sessionId,
        ifUpdatedAfter: '2026-11-26T10:00:00.000Z',
      });
      expect(res.status).toBe(404);
      expect(res.json.error).toBe(KIRO_SESSION_NOT_FOUND);
    }
    const bad = await post(c.url, '/api/kiro/sessions/open', {
      sessionId: USED,
      ifUpdatedAfter: 'yesterday',
    });
    expect(bad.status).toBe(400);
    const log = await c.log();
    expect(loads(log)).toBe(0);
    expect(log.some((m) => m.method === 'session/list')).toBe(false);
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
      isBusy: vi.fn(() => false),
      onAgentNotification: vi.fn((l: (method: string, params: unknown) => void) => {
        listener = l;
        return () => undefined;
      }),
      ...overrides,
    } as unknown as KiroSessionsAgent & {
      listSessions: ReturnType<typeof vi.fn>;
      replaySession: ReturnType<typeof vi.fn>;
      isBusy: ReturnType<typeof vi.fn>;
    };
    return { agent, notify: (method: string) => listener?.(method, {}) };
  }

  async function handlerUrl(
    agent: KiroSessionsAgent,
    status: KiroStatus = SIGNED_IN,
    now?: () => number,
    stampWaitMs?: number,
    findCwd: (sessionId: string) => Promise<string | undefined> = async () => '/work/project'
  ) {
    const handler = createKiroSessionsHandler({
      agent,
      statusReader: { read: async () => status },
      now,
      stampWaitMs,
      findCwd,
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

  it("reports the time from a list of the session's folder, else the cached one (K11)", async () => {
    const cached = '2026-11-26T10:00:00.000Z';
    const exact = '2026-11-26T10:05:00.000Z';
    const { agent } = stub();
    agent.listSessions.mockImplementation(async (params?: { cwd?: string }) => ({
      sessions: [entry(USED, 'Used', params?.cwd ? exact : cached)],
    }));
    const url = await handlerUrl(agent);
    expect((await post(url, '/open', { sessionId: USED })).json.updatedAt).toBe(exact);
    expect(agent.listSessions).toHaveBeenLastCalledWith({ cwd: '/work/project' });

    // The folder list fails: the cached time
    const failing = stub();
    failing.agent.listSessions.mockImplementation(async (params?: { cwd?: string }) => {
      if (params?.cwd) throw new Error('list failed');
      return { sessions: [entry(USED, 'Used', cached)] };
    });
    const failed = await post(await handlerUrl(failing.agent), '/open', { sessionId: USED });
    expect(failed.status).toBe(200);
    expect(failed.json.updatedAt).toBe(cached);

    // The folder list hangs: the cached time after the wait
    const hanging = stub();
    hanging.agent.listSessions.mockImplementation((params?: { cwd?: string }) =>
      params?.cwd
        ? new Promise(() => undefined)
        : Promise.resolve({ sessions: [entry(USED, 'Used', cached)] })
    );
    const started = Date.now();
    const slow = await post(await handlerUrl(hanging.agent, SIGNED_IN, undefined, 100), '/open', {
      sessionId: USED,
    });
    expect(slow.json.updatedAt).toBe(cached);
    expect(Date.now() - started).toBeLessThan(1000);
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

  describe('with ifUpdatedAfter (K11 B4)', () => {
    const AT = '2026-11-26T10:00:00.000Z';
    const NEWER = '2026-11-26T10:05:00.000Z';
    /** A full list without the session, and a folder list with it at `at` */
    function folderOnly(at: string) {
      const s = stub();
      s.agent.listSessions.mockImplementation(async (params?: { cwd?: string }) => ({
        sessions: params?.cwd ? [entry(USED, 'Used', at)] : [entry(OLDER, 'Other')],
      }));
      return s;
    }

    it('answers unchanged from the folder list, with no full list and no replay', async () => {
      const { agent } = folderOnly(AT);
      const url = await handlerUrl(agent);
      const res = await post(url, '/open', { sessionId: USED, ifUpdatedAfter: AT });
      expect(res.json).toEqual({ unchanged: true, updatedAt: AT });
      expect(agent.listSessions).toHaveBeenCalledTimes(1);
      expect(agent.listSessions).toHaveBeenCalledWith({ cwd: '/work/project' });
      expect(agent.replaySession).not.toHaveBeenCalled();
      expect(res.text).not.toContain('/work');
    });

    it('replays a session that only the folder list has, with the exact time', async () => {
      const { agent } = folderOnly(NEWER);
      const url = await handlerUrl(agent);
      const res = await post(url, '/open', { sessionId: USED, ifUpdatedAfter: AT });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ title: 'Used', updatedAt: NEWER, turns: 0 });
      expect(agent.replaySession).toHaveBeenCalledWith(USED, '/work/project', expect.any(Function));
      // Only folder lists: no full list on this path
      for (const [params] of agent.listSessions.mock.calls as [{ cwd?: string }?][]) {
        expect(params?.cwd).toBe('/work/project');
      }
      expect(res.text).not.toContain('/work');
    });

    it('answers 409 with no replay when the folder list says a turn runs (B5)', async () => {
      const { agent } = stub();
      agent.listSessions.mockResolvedValue({
        sessions: [{ ...entry(USED, 'Used', NEWER), _meta: { kiro: { status: 'in_progress' } } }],
      });
      const res = await post(await handlerUrl(agent), '/open', {
        sessionId: USED,
        ifUpdatedAfter: AT,
      });
      expect(res.status).toBe(409);
      expect(res.json.error).toBe(KIRO_SESSION_BUSY);
      expect(agent.listSessions).toHaveBeenCalledTimes(1);
      expect(agent.replaySession).not.toHaveBeenCalled();
      expect(res.text).not.toContain('/work');
    });

    it('falls back to the full list when the folder list lacks the id, with one folder read (B5)', async () => {
      const { agent } = stub();
      // session.json names one form of the folder; Kiro lists the session under another
      agent.listSessions.mockImplementation(async (params?: { cwd?: string }) => ({
        sessions: params?.cwd
          ? [entry(OLDER, 'Other')]
          : [{ ...entry(USED, 'Used', NEWER), cwd: '/work/project-link' }],
      }));
      const res = await post(await handlerUrl(agent), '/open', {
        sessionId: USED,
        ifUpdatedAfter: AT,
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ title: 'Used', updatedAt: NEWER });
      expect(res.json.unchanged).toBeUndefined();
      // The load uses the folder that Kiro lists, not the session.json one
      expect(agent.replaySession).toHaveBeenCalledWith(
        USED,
        '/work/project-link',
        expect.any(Function)
      );
      const calls = agent.listSessions.mock.calls as [{ cwd?: string }?][];
      expect(calls.filter(([params]) => params?.cwd)).toHaveLength(1);
      expect(calls.filter(([params]) => !params?.cwd)).toHaveLength(1);
      expect(res.text).not.toContain('/work');
    });

    it('answers 404 with no replay when there is no session.json or no list has it', async () => {
      const { agent } = stub();
      const noFile = await post(
        await handlerUrl(agent, SIGNED_IN, undefined, undefined, async () => undefined),
        '/open',
        { sessionId: USED, ifUpdatedAfter: AT }
      );
      expect(noFile.status).toBe(404);
      expect(agent.listSessions).not.toHaveBeenCalled();

      const other = stub();
      other.agent.listSessions.mockResolvedValue({ sessions: [entry(OLDER, 'Other')] });
      const missing = await post(await handlerUrl(other.agent), '/open', {
        sessionId: USED,
        ifUpdatedAfter: AT,
      });
      expect(missing.status).toBe(404);
      expect(missing.json.error).toBe(KIRO_SESSION_NOT_FOUND);
      expect(other.agent.replaySession).not.toHaveBeenCalled();
    });

    it('replays as without ifUpdatedAfter when the folder list fails or is slow, never unchanged', async () => {
      const failing = stub();
      failing.agent.listSessions.mockImplementation(async (params?: { cwd?: string }) => {
        if (params?.cwd) throw new Error('list failed');
        return { sessions: [entry(USED, 'Used', AT)] };
      });
      const failed = await post(await handlerUrl(failing.agent), '/open', {
        sessionId: USED,
        ifUpdatedAfter: AT,
      });
      expect(failed.status).toBe(200);
      expect(failed.json.unchanged).toBeUndefined();
      expect(failed.json.updatedAt).toBe(AT);
      expect(failing.agent.replaySession).toHaveBeenCalledTimes(1);
      // No second folder read after the replay: the full list's time
      const failedCalls = failing.agent.listSessions.mock.calls as [{ cwd?: string }?][];
      expect(failedCalls.filter(([params]) => params?.cwd)).toHaveLength(1);

      const hanging = stub();
      hanging.agent.listSessions.mockImplementation((params?: { cwd?: string }) =>
        params?.cwd
          ? new Promise(() => undefined)
          : Promise.resolve({ sessions: [entry(USED, 'Used', AT)] })
      );
      const started = Date.now();
      const slow = await post(await handlerUrl(hanging.agent, SIGNED_IN, undefined, 100), '/open', {
        sessionId: USED,
        ifUpdatedAfter: AT,
      });
      expect(slow.status).toBe(200);
      expect(slow.json.unchanged).toBeUndefined();
      expect(hanging.agent.replaySession).toHaveBeenCalledTimes(1);
      expect(slow.json.updatedAt).toBe(AT);
      // One wait only (B5): no second folder read after the replay
      const hangingCalls = hanging.agent.listSessions.mock.calls as [{ cwd?: string }?][];
      expect(hangingCalls.filter(([params]) => params?.cwd)).toHaveLength(1);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('answers 409 while a reply runs in the session, with no list and no replay', async () => {
      const { agent } = stub();
      agent.isBusy.mockReturnValue(true);
      const res = await post(await handlerUrl(agent), '/open', {
        sessionId: USED,
        ifUpdatedAfter: AT,
      });
      expect(res.status).toBe(409);
      expect(res.json.error).toBe(KIRO_SESSION_BUSY);
      expect(agent.listSessions).not.toHaveBeenCalled();
      expect(agent.replaySession).not.toHaveBeenCalled();
    });
  });
});
