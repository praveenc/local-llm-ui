// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer, request as httpRequest } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIRO_STOP_NOTICES } from '../../src/utils/kiroChat.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import type { KiroProxy } from '../kiro-proxy.ts';
import { KiroAgent } from '../kiro/agent.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';
import { isPromptEcho } from '../kiro/reply-meta.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-kiro-acp.mjs'
);

const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/.local/bin/kiro-cli',
  version: '3.5.0',
  account: { type: 'builder-id', email: 'me@example.com' },
};
const SIGNED_OUT: KiroStatus = {
  state: 'signed-out',
  path: '~/.local/bin/kiro-cli',
  version: '3.5.0',
};

let root: string;
let binary: string;
let counter = 0;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kiro-chat-test-'));
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

type Event = Record<string, unknown> | '[DONE]';

interface Setup {
  agent: KiroAgent;
  status: { current: KiroStatus };
  url: string;
  home: string;
  log(): Promise<Record<string, unknown>[]>;
}

async function setup(
  opts: { env?: Record<string, string>; busyWaitMs?: number; pingMs?: number } = {}
): Promise<Setup> {
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
      ...opts.env,
    },
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
    chatBusyWaitMs: opts.busyWaitMs,
    chatPingMs: opts.pingMs,
  });
  const server: Server = createServer((req, res) => {
    void proxy(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  cleanups.push(async () => {
    proxy.close();
    await agent.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    agent,
    status,
    home,
    url: `http://127.0.0.1:${port}`,
    async log() {
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

function parseEvents(text: string): Event[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => block.slice(6))
    .map((data) => (data === '[DONE]' ? '[DONE]' : (JSON.parse(data) as Record<string, unknown>)));
}

async function chat(c: Setup, body: unknown) {
  const res = await fetch(`${c.url}/api/kiro/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const isSse = res.headers.get('content-type')?.startsWith('text/event-stream');
  return {
    status: res.status,
    events: isSse ? parseEvents(text) : [],
    json: isSse ? undefined : (JSON.parse(text) as Record<string, unknown>),
  };
}

const ofKind = (events: Event[], key: string) =>
  events.filter((e): e is Record<string, unknown> => e !== '[DONE]' && key in e).map((e) => e[key]);
const contentOf = (events: Event[]) => ofKind(events, 'content').join('');

const base = { history: [], seenMessages: 0, model: 'claude-fake-1' };

async function configCalls(c: Setup) {
  return (await c.log())
    .filter((m) => m.method === 'session/set_config_option')
    .map((m) => m.params as { configId: string; value: string })
    .map((p) => `${p.configId}=${p.value}`);
}

describe('POST /api/kiro/chat', () => {
  it('streams a reply: status, session, reasoning, content, title, metadata, [DONE]', async () => {
    const c = await setup();
    const { status, events } = await chat(c, { ...base, prompt: 'hello' });
    expect(status).toBe(200);
    expect(events[0]).toEqual({ status: 'Starting Kiro…' });
    const session = (events[1] as { session: { id: string; created: boolean } }).session;
    expect(session).toEqual({ id: expect.stringMatching(/^sess_/) as string, created: true });
    expect(ofKind(events, 'reasoning')).toEqual([`thinking about ${session.id}`]);
    expect(contentOf(events)).toBe('echo: hello');
    // Kiro sends the same title twice: one event
    expect(ofKind(events, 'title')).toEqual(['Fake title']);
    expect(ofKind(events, 'metadata')).toEqual([
      { usage: { credits: 0.05, contextPercent: 4.2 }, latencyMs: 1200 },
    ]);
    expect(events.at(-1)).toBe('[DONE]');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[kiro\] chat reply ended: end_turn \(\d+ ms\)$/)
    );
    // The session opened in the app folder, never one from the browser
    const created = (await c.log()).find((m) => m.method === 'session/new');
    expect((created?.params as { cwd: string }).cwd).toBe(
      path.join(c.home, '.local-llm-ui', 'kiro')
    );
  });

  it('ignores a folder in the chat body (SEC-16, SEC-21)', async () => {
    const c = await setup();
    const { status } = await chat(c, {
      ...base,
      prompt: 'hello',
      cwd: '/tmp',
      workspaceDir: '/tmp',
    });
    expect(status).toBe(200);
    const created = (await c.log()).find((m) => m.method === 'session/new');
    expect((created?.params as { cwd: string }).cwd).toBe(
      path.join(c.home, '.local-llm-ui', 'kiro')
    );
  });

  it('reuses the session with no context block, and a stale chat gets a new session', async () => {
    const c = await setup();
    const first = await chat(c, { ...base, prompt: 'one' });
    const id = (first.events[1] as { session: { id: string } }).session.id;
    const history = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'echo: one' },
    ];

    const second = await chat(c, {
      ...base,
      sessionId: id,
      history,
      seenMessages: 2,
      prompt: 'two',
    });
    expect(second.events[0]).toEqual({ session: { id, created: false } });
    expect(contentOf(second.events)).toBe('echo: two');
    expect((await c.log()).filter((m) => m.method === 'session/new')).toHaveLength(1);

    // The chat lost messages that the session saw: a new session with the whole history
    const stale = await chat(c, {
      ...base,
      sessionId: id,
      history,
      seenMessages: 5,
      prompt: 'three',
    });
    const staleSession = (stale.events[0] as { session: { id: string; created: boolean } }).session;
    expect(staleSession.created).toBe(true);
    expect(staleSession.id).not.toBe(id);
    const text = contentOf(stale.events);
    expect(text).toContain('<conversation_context>');
    expect(text).toContain('<message role="user">\none\n</message>');
    expect(text).toContain('<message role="assistant">\necho: one\n</message>');
    expect(text.endsWith('three')).toBe(true);
  });

  it('makes a new session for a session id that is not on disk', async () => {
    const c = await setup();
    const unknown = 'sess_11111111-2222-4333-8444-555555555555';
    const { events } = await chat(c, {
      ...base,
      sessionId: unknown,
      history: [{ role: 'user', content: 'earlier' }],
      seenMessages: 1,
      prompt: 'again',
    });
    const session = (events[1] as { session: { id: string; created: boolean } }).session;
    expect(session.created).toBe(true);
    expect(session.id).not.toBe(unknown);
    // A new session has seen nothing
    expect(contentOf(events)).toContain('<message role="user">\nearlier\n</message>');
    expect((await c.log()).some((m) => m.method === 'session/load')).toBe(false);
  });

  it('sets the model and the effort only when they differ', async () => {
    const c = await setup();
    const first = await chat(c, { ...base, prompt: 'a' });
    const id = (first.events[1] as { session: { id: string } }).session.id;
    // auto → claude-fake-1 resets the effort to its default (medium), which Default wants
    expect(await configCalls(c)).toEqual(['model=claude-fake-1']);

    const next = { ...base, sessionId: id, history: [], seenMessages: 0 };
    await chat(c, { ...next, prompt: 'b', thinkingEffort: 'high' });
    expect(await configCalls(c)).toEqual(['model=claude-fake-1', 'effortLevel=high']);
    await chat(c, { ...next, prompt: 'c', thinkingEffort: 'high' });
    expect(await configCalls(c)).toEqual(['model=claude-fake-1', 'effortLevel=high']);

    // A model with only a thinking switch: Off turns it off
    await chat(c, { ...next, model: 'think-fake', prompt: 'd', thinkingEffort: 'off' });
    expect((await configCalls(c)).slice(2)).toEqual(['model=think-fake', 'thinking=off']);
  });

  it('sends an error for a model that Kiro does not offer', async () => {
    const c = await setup();
    const { events } = await chat(c, { ...base, model: 'nope-model', prompt: 'x' });
    expect(ofKind(events, 'error')).toEqual([
      'Kiro does not offer the model nope-model any more. Select a different model.',
    ]);
    expect(events.at(-1)).toBe('[DONE]');
    expect((await c.log()).some((m) => m.method === 'session/prompt')).toBe(false);
  });

  it('shows a tool call and its result; an MCP tool keeps its title', async () => {
    const c = await setup();
    const { events } = await chat(c, { ...base, prompt: 'TOOLOK' });
    expect(ofKind(events, 'toolCall')).toEqual([
      { id: 'read_file_toolu_bdrk_01FAKE', name: 'read_file', args: {} },
    ]);
    expect(ofKind(events, 'toolResult')).toEqual([
      { id: 'read_file_toolu_bdrk_01FAKE', name: 'read_file', result: 'line one\n\nline two' },
    ]);

    const mcp = await chat(c, { ...base, prompt: 'MCPTOOL' });
    expect(ofKind(mcp.events, 'toolCall')).toEqual([
      { id: 'search_abc123', name: '@fake/search', args: { query: 'zeros' } },
    ]);
    expect(ofKind(mcp.events, 'toolResult')).toEqual([
      { id: 'search_abc123', name: '@fake/search', result: '{"items":2}' },
    ]);
  });

  it('adds a notice for a max_tokens stop', async () => {
    const c = await setup();
    const { events } = await chat(c, { ...base, prompt: 'MAXTOKENS' });
    expect(contentOf(events).endsWith(`\n\n_${KIRO_STOP_NOTICES.max_tokens}_`)).toBe(true);
    expect(events.at(-1)).toBe('[DONE]');
  });

  it('cancels the reply when the browser closes the stream', async () => {
    const c = await setup();
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        `${c.url}/api/kiro/chat`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let text = '';
          res.on('data', (chunk: Buffer) => {
            text += chunk.toString();
            // The reasoning comes once the prompt runs: stop then
            if (text.includes('"reasoning"')) {
              req.destroy();
              resolve();
            }
          });
        }
      );
      req.on('error', () => undefined);
      req.on('close', () => resolve());
      setTimeout(() => reject(new Error('no reasoning')), 5000).unref();
      req.end(JSON.stringify({ ...base, prompt: 'WAIT' }));
    });
    await vi.waitFor(
      () =>
        expect(console.log).toHaveBeenCalledWith(
          expect.stringMatching(/chat reply ended: cancelled/)
        ),
      { timeout: 3000 }
    );
    expect((await c.log()).some((m) => m.method === 'session/cancel')).toBe(true);
  });

  it('says that Kiro is busy when a reply runs longer than the wait', async () => {
    const c = await setup({ busyWaitMs: 200 });
    const first = await chat(c, { ...base, prompt: 'one' });
    const id = (first.events[1] as { session: { id: string } }).session.id;
    const next = { ...base, sessionId: id, history: [], seenMessages: 0 };

    const controller = new AbortController();
    const waiting = fetch(`${c.url}/api/kiro/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...next, prompt: 'WAIT' }),
      signal: controller.signal,
    });
    const res = await waiting;
    const reader = res.body!.getReader();
    // Wait until the first reply runs
    let seen = '';
    while (!seen.includes('"reasoning"')) {
      const { value } = await reader.read();
      seen += new TextDecoder().decode(value);
    }
    const busy = await chat(c, { ...next, model: 'think-fake', prompt: 'two' });
    expect(ofKind(busy.events, 'error')).toEqual([
      'Kiro is still answering in this chat. Wait for the reply, or click Stop.',
    ]);
    // The busy error comes before any option change, and with no session event
    expect(ofKind(busy.events, 'session')).toEqual([]);
    expect((await configCalls(c)).filter((call) => call.startsWith('model=think'))).toEqual([]);
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await vi.waitFor(
      () =>
        expect(console.log).toHaveBeenCalledWith(
          expect.stringMatching(/chat reply ended: cancelled/)
        ),
      { timeout: 3000 }
    );
  });

  it('waits for a stopped reply to end, then answers a second request at once', async () => {
    const c = await setup();
    const first = await chat(c, { ...base, prompt: 'one' });
    const id = (first.events[1] as { session: { id: string } }).session.id;
    const next = { ...base, sessionId: id, history: [], seenMessages: 0 };

    const controller = new AbortController();
    const res = await fetch(`${c.url}/api/kiro/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...next, prompt: 'WAIT' }),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    let seen = '';
    while (!seen.includes('"reasoning"')) {
      const { value } = await reader.read();
      seen += new TextDecoder().decode(value);
    }
    // Stop, and the second request at once (a quick resend)
    controller.abort();
    await reader.cancel().catch(() => undefined);
    const second = await chat(c, { ...next, prompt: 'two', thinkingEffort: 'high' });
    expect(ofKind(second.events, 'error')).toEqual([]);
    expect(second.events[0]).toEqual({ session: { id, created: false } });
    expect(contentOf(second.events)).toBe('echo: two');
    expect(second.events.at(-1)).toBe('[DONE]');
    expect(await configCalls(c)).toEqual(['model=claude-fake-1', 'effortLevel=high']);
  });

  it('says so when Kiro crashes during a reply, and a later request works', async () => {
    const c = await setup();
    const crashed = await chat(c, { ...base, prompt: 'CRASH' });
    const id = (crashed.events[1] as { session: { id: string } }).session.id;
    expect(ofKind(crashed.events, 'error')).toEqual([
      'Kiro stopped during the reply. Send the message again.',
    ]);
    expect(crashed.events.at(-1)).toBe('[DONE]');

    const again = await chat(c, { ...base, sessionId: id, prompt: 'after' });
    expect(again.events[1]).toEqual({ session: { id, created: false } });
    expect(contentOf(again.events)).toBe('echo: after');
    expect((await c.log()).some((m) => m.method === 'session/load')).toBe(true);
  });

  it('skips the effort for a session without an effortLevel option (kiro-cli 3.4)', async () => {
    const c = await setup({ env: { FAKE_KIRO_NO_EFFORT: '1' } });
    const { events } = await chat(c, { ...base, prompt: 'hi', thinkingEffort: 'high' });
    expect(ofKind(events, 'error')).toEqual([]);
    expect(contentOf(events)).toBe('echo: hi');
    expect(await configCalls(c)).toEqual(['model=claude-fake-1']);
  });

  it('starts a new session when session/load fails for a damaged session', async () => {
    const c = await setup({ env: { FAKE_KIRO_MODE: 'load-error' } });
    const first = await chat(c, { ...base, prompt: 'one' });
    const id = (first.events[1] as { session: { id: string } }).session.id;
    // The session is no longer live: the next request must load it
    await c.agent.stop();
    const { events } = await chat(c, {
      ...base,
      sessionId: id,
      history: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'echo: one' },
      ],
      seenMessages: 2,
      prompt: 'two',
    });
    const session = (events[1] as { session: { id: string; created: boolean } }).session;
    expect(session.created).toBe(true);
    expect(session.id).not.toBe(id);
    expect(contentOf(events)).toContain('<message role="user">\none\n</message>');
    expect((await c.log()).some((m) => m.method === 'session/load')).toBe(true);
  });

  it('deletes its new session and sends no prompt when the browser stops before the prompt', async () => {
    const c = await setup({ env: { FAKE_KIRO_SLOW_CONFIG_MS: '400' } });
    let text = '';
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        `${c.url}/api/kiro/chat`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => res.on('data', (chunk: Buffer) => (text += chunk.toString()))
      );
      req.on('error', () => undefined);
      req.end(JSON.stringify({ ...base, prompt: 'hello' }));
      // Stop while the model option is being set
      const poll = setInterval(() => {
        void c.log().then((log) => {
          const setting = log.some(
            (m) =>
              m.method === 'session/set_config_option' &&
              (m.params as { configId: string }).configId === 'model'
          );
          if (setting) {
            clearInterval(poll);
            req.destroy();
            resolve();
          }
        });
      }, 10);
      setTimeout(() => {
        clearInterval(poll);
        reject(new Error('no set_config_option'));
      }, 5000).unref();
    });
    await vi.waitFor(
      () =>
        expect(console.log).toHaveBeenCalledWith(
          expect.stringMatching(/chat reply ended: cancelled/)
        ),
      { timeout: 3000 }
    );
    expect(text).not.toContain('"session"');
    const log = await c.log();
    const deleted = log.filter((m) => m.method === 'session/delete');
    expect(deleted).toHaveLength(1);
    expect(log.some((m) => m.method === 'session/prompt')).toBe(false);
  });

  it('shows a display_error when the reply has no text, but not an MCP connection error', async () => {
    const c = await setup();
    const quota = await chat(c, { ...base, prompt: 'DISPLAYERR' });
    expect(contentOf(quota.events)).toBe('\n\n_You have used all your credits._');
    expect(quota.events.at(-1)).toBe('[DONE]');

    const mcp = await chat(c, { ...base, prompt: 'MCPERR' });
    expect(ofKind(mcp.events, 'content')).toEqual([]);
    expect(mcp.events.at(-1)).toBe('[DONE]');
  });

  it('answers 401 when signed out, 400 for a bad body, and 405 for GET', async () => {
    const c = await setup();
    c.status.current = SIGNED_OUT;
    const signedOut = await chat(c, { ...base, prompt: 'x' });
    expect(signedOut).toMatchObject({
      status: 401,
      json: { error: 'Sign in to Kiro in Preferences → Providers.' },
    });
    c.status.current = SIGNED_IN;
    expect(await chat(c, '{nope')).toMatchObject({
      status: 400,
      json: { error: 'The request body is not valid JSON' },
    });
    expect(await chat(c, { ...base, prompt: '' })).toMatchObject({
      status: 400,
      json: { error: 'The message is empty' },
    });
    const get = await fetch(`${c.url}/api/kiro/chat`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    c.status.current = { state: 'not-installed' };
    expect((await chat(c, { ...base, prompt: 'x' })).status).toBe(503);
    // Nothing started Kiro
    expect(c.agent.state().running).toBe(false);
  });
});

interface LiveChat {
  events: Event[];
  /** Everything that the stream sent, also comments */
  raw(): string;
  /** The next event of this kind after `from` events */
  next(key: string, from?: number): Promise<Record<string, unknown>>;
  done: Promise<void>;
  close(): void;
}

/** A chat whose events the test reads while the stream is open */
function liveChat(c: Setup, body: unknown): LiveChat {
  const events: Event[] = [];
  let text = '';
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch(`${c.url}/api/kiro/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let parsed = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      text += decoder.decode(value, { stream: true });
      const blocks = text.split('\n\n');
      const complete = blocks.slice(0, -1).join('\n\n');
      const all = parseEvents(complete);
      events.push(...all.slice(parsed));
      parsed = all.length;
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) throw error;
  });
  return {
    events,
    raw: () => text,
    async next(key, from = 0) {
      let found: Record<string, unknown> | undefined;
      await vi.waitFor(
        () => {
          found = events
            .slice(from)
            .find((e): e is Record<string, unknown> => e !== '[DONE]' && key in e);
          expect(found).toBeDefined();
        },
        { timeout: 5000, interval: 10 }
      );
      return found![key] as Record<string, unknown>;
    },
    done,
    close: () => controller.abort(),
  };
}

const answer = (c: Setup, body: unknown) =>
  fetch(`${c.url}/api/kiro/permission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const kiroAnswers = async (c: Setup) =>
  (await c.log())
    .filter((m) => m.method === undefined && (m.result as { outcome?: unknown })?.outcome)
    .map((m) => m.result);

describe('Kiro permission questions (K6)', () => {
  it('sends the question, takes the answer, and the tool completes', async () => {
    const c = await setup();
    const live = liveChat(c, { ...base, prompt: 'TOOL' });
    const call = await live.next('toolCall');
    const question = await live.next('permission');
    expect(question).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/) as string,
      toolCallId: call.id,
      title: 'echo hi > hello.txt',
      // Kiro's options in Kiro's order
      options: [
        { optionId: 'o1', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'o2', name: 'Deny', kind: 'reject_once' },
        { optionId: 'o3', name: 'Allow', kind: 'allow_once' },
        { optionId: 'o4', name: 'Always deny', kind: 'reject_always' },
      ],
      command: 'echo hi > hello.txt',
      resource: 'echo hi > hello.txt',
    });
    const { requestId } = question as { requestId: string };
    const res = await answer(c, { requestId, optionId: 'o3' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answered: true });
    await live.done;
    expect(ofKind(live.events, 'permissionResult')).toEqual([
      { requestId, optionId: 'o3', kind: 'allow_once', outcome: 'answered' },
    ]);
    expect(ofKind(live.events, 'toolResult')).toEqual([
      { id: call.id, name: 'execute', result: '{"message":"hi"}' },
    ]);
    expect(await kiroAnswers(c)).toEqual([{ outcome: { outcome: 'selected', optionId: 'o3' } }]);
    expect(live.events.at(-1)).toBe('[DONE]');
    // Answered once: a second answer finds no question
    expect((await answer(c, { requestId, optionId: 'o3' })).status).toBe(404);
  });

  it("denies with the user's option: the tool fails with Kiro's text and the turn goes on", async () => {
    const c = await setup();
    const live = liveChat(c, { ...base, prompt: 'TOOL' });
    const { requestId } = (await live.next('permission')) as { requestId: string };
    expect((await answer(c, { requestId, optionId: 'o2' })).status).toBe(200);
    await live.done;
    expect(ofKind(live.events, 'permissionResult')).toEqual([
      { requestId, optionId: 'o2', kind: 'reject_once', outcome: 'answered' },
    ]);
    const [result] = ofKind(live.events, 'toolResult') as { error?: string }[];
    expect(result.error).toContain('The user rejected this tool call.');
    expect(contentOf(live.events)).toContain('echo: TOOL');
    expect(live.events.at(-1)).toBe('[DONE]');
  });

  it('refuses an option that the question does not list, and the question stays open', async () => {
    const c = await setup();
    const live = liveChat(c, { ...base, prompt: 'TOOL' });
    const { requestId } = (await live.next('permission')) as { requestId: string };
    const wrong = await answer(c, { requestId, optionId: 'w1' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'Kiro did not offer this option' });
    expect((await answer(c, { requestId, optionId: 'o2' })).status).toBe(200);
    await live.done;
    expect(await kiroAnswers(c)).toEqual([{ outcome: { outcome: 'selected', optionId: 'o2' } }]);
  });

  it('cancels the open question when the stream closes', async () => {
    const c = await setup();
    const live = liveChat(c, { ...base, prompt: 'TOOL' });
    const { requestId } = (await live.next('permission')) as { requestId: string };
    live.close();
    await vi.waitFor(
      () =>
        expect(console.log).toHaveBeenCalledWith(
          expect.stringMatching(/chat reply ended: cancelled/)
        ),
      { timeout: 3000 }
    );
    expect(await kiroAnswers(c)).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect((await answer(c, { requestId, optionId: 'o3' })).status).toBe(404);
    // The session works again
    const next = await chat(c, { ...base, prompt: 'hello' });
    expect(contentOf(next.events)).toBe('echo: hello');
  });

  it('asks for a write, then "Review changes" with the write as its related tool call', async () => {
    const c = await setup();
    const live = liveChat(c, { ...base, prompt: 'WRITE' });
    const write = (await live.next('permission')) as { requestId: string };
    expect(write).toMatchObject({
      toolCallId: 'toolu_fake_write',
      title: 'Write File',
      resource: 'notes.txt',
    });
    expect(write).not.toHaveProperty('review');
    expect((await answer(c, { requestId: write.requestId, optionId: 'w1' })).status).toBe(200);
    const first = live.events.length;
    const review = (await live.next('permission', first)) as { requestId: string };
    expect(review).toEqual({
      requestId: expect.any(String) as string,
      toolCallId: expect.stringMatching(/^turn_approval_/) as string,
      title: 'Review changes',
      options: [
        { optionId: 'r1', name: 'Accept changes', kind: 'allow_once' },
        { optionId: 'r2', name: 'Reject changes', kind: 'reject_once' },
      ],
      relatedToolCallIds: ['toolu_fake_write'],
      review: true,
    });
    expect(review.requestId).not.toBe(write.requestId);
    expect((await answer(c, { requestId: review.requestId, optionId: 'r2' })).status).toBe(200);
    await live.done;
    expect(ofKind(live.events, 'permissionResult')).toEqual([
      { requestId: write.requestId, optionId: 'w1', kind: 'allow_once', outcome: 'answered' },
      { requestId: review.requestId, optionId: 'r2', kind: 'reject_once', outcome: 'answered' },
    ]);
    const [result] = ofKind(live.events, 'toolResult') as { id: string; error?: string }[];
    expect(result.id).toBe('toolu_fake_write');
    expect(result.error).toContain('rejected');
  });

  it('sends a ping comment while a question is open, and none after it', async () => {
    const c = await setup({ pingMs: 30 });
    // SLOW: the reply streams for about 160 ms after the question
    const live = liveChat(c, { ...base, prompt: 'TOOL SLOW' });
    const { requestId } = (await live.next('permission')) as { requestId: string };
    await vi.waitFor(() => expect(live.raw()).toContain(': ping\n\n'), { timeout: 3000 });
    await answer(c, { requestId, optionId: 'o3' });
    await live.done;
    const after = live.raw().slice(live.raw().indexOf('"permissionResult"'));
    expect(after).toContain('echo');
    expect(after).not.toContain(': ping');
  });
});

describe('POST /api/kiro/permission', () => {
  it('answers 404 for an unknown id, 400 for a bad body, 413 for a big one, 405 for GET', async () => {
    const c = await setup();
    const unknown = await answer(c, {
      requestId: '11111111-2222-4333-8444-555555555555',
      optionId: 'o1',
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'This question has ended' });
    expect((await answer(c, '{nope')).status).toBe(400);
    expect((await answer(c, { requestId: 'not-a-uuid', optionId: 'o1' })).status).toBe(400);
    expect((await answer(c, { requestId: '11111111-2222-4333-8444-555555555555' })).status).toBe(
      400
    );
    const big = await answer(c, {
      requestId: '11111111-2222-4333-8444-555555555555',
      optionId: 'x'.repeat(2000),
    });
    expect(big.status).toBe(413);
    const get = await fetch(`${c.url}/api/kiro/permission`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    // The route never starts Kiro CLI
    expect(c.agent.state().running).toBe(false);
  });
});

interface Snapshot {
  mode?: { id: string; currentValue: string; values: { value: string; name: string }[] };
  options: { id: string; name: string; currentValue: string }[];
}
const snapshots = (events: Event[]) => ofKind(events, 'sessionOptions') as Snapshot[];

describe('POST /api/kiro/chat session options (K9)', () => {
  it('sends the agent and the options without an app control right after the session', async () => {
    const c = await setup();
    const { events } = await chat(c, { ...base, prompt: 'hello' });
    const at = events.findIndex((e) => e !== '[DONE]' && 'session' in e);
    expect(events[at + 1]).toHaveProperty('sessionOptions');
    const [snapshot] = snapshots(events);
    expect(snapshot.mode).toMatchObject({ id: 'mode', currentValue: 'vibe' });
    expect(snapshot.mode?.values.map((v) => v.name)).toEqual(['Default', 'Agent B', 'Agent C']);
    // model, effortLevel, and thinking have app controls
    expect(snapshot.options).toEqual([
      expect.objectContaining({ id: 'autopilot', name: 'Autopilot', currentValue: 'on' }),
    ]);
    // `_meta` never reaches the browser
    expect(JSON.stringify(snapshot)).not.toContain('_meta');
  });

  it('sets the agent first, then the other options, then the model, and only what changed', async () => {
    const c = await setup();
    const first = await chat(c, {
      ...base,
      prompt: 'a',
      sessionOptions: { autopilot: 'off', mode: 'agent-b' },
    });
    expect(ofKind(first.events, 'error')).toEqual([]);
    expect(await configCalls(c)).toEqual(['mode=agent-b', 'autopilot=off', 'model=claude-fake-1']);
    const id = (first.events[1] as { session: { id: string } }).session.id;
    const last = snapshots(first.events).at(-1)!;
    expect(last.mode?.currentValue).toBe('agent-b');
    expect(last.options[0].currentValue).toBe('off');

    // The same values again: nothing to set
    await chat(c, {
      ...base,
      sessionId: id,
      prompt: 'b',
      sessionOptions: { mode: 'agent-b', autopilot: 'off' },
    });
    expect(await configCalls(c)).toHaveLength(3);
  });

  it('fails the reply for an unlisted value before anything reaches Kiro', async () => {
    const c = await setup();
    const { events } = await chat(c, {
      ...base,
      prompt: 'x',
      sessionOptions: { mode: 'agent-b', autopilot: 'maybe' },
    });
    expect(ofKind(events, 'error')).toEqual([
      'Kiro does not offer this value for Autopilot. Pick another value.',
    ]);
    expect(events.at(-1)).toBe('[DONE]');
    // Not even the listed mode: the check comes before any send
    expect(await configCalls(c)).toEqual([]);
    expect((await c.log()).some((m) => m.method === 'session/prompt')).toBe(false);
    // An unlisted agent is refused the same way (Kiro would reset it to the default)
    const agent = await chat(c, { ...base, prompt: 'y', sessionOptions: { mode: 'agent-z' } });
    expect(ofKind(agent.events, 'error')).toEqual([
      'Kiro does not offer this value for Mode. Pick another value.',
    ]);
    expect(await configCalls(c)).toEqual([]);
  });

  it('drops an unknown id and an option that an app control sets, and logs only the count', async () => {
    const c = await setup();
    const { events } = await chat(c, {
      ...base,
      prompt: 'x',
      sessionOptions: { nope: 'on', thinking: 'off', model: 'auto', effortLevel: 'low' },
    });
    expect(ofKind(events, 'error')).toEqual([]);
    expect(contentOf(events)).toBe('echo: x');
    // Only the request's model (base: claude-fake-1); never `thinking=off` or `effortLevel=low`
    expect(await configCalls(c)).toEqual(['model=claude-fake-1']);
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain(
      '[kiro] dropped 4 session options that the session does not list or that an app control sets'
    );
    expect(logged).not.toContain('nope');
  });

  it('fails the reply with a plain error when Kiro does not take the value', async () => {
    const c = await setup({ env: { FAKE_KIRO_STUCK_OPTION: 'autopilot' } });
    const { events } = await chat(c, {
      ...base,
      prompt: 'x',
      sessionOptions: { autopilot: 'off' },
    });
    expect(ofKind(events, 'error')).toEqual(['Kiro did not change Autopilot. Try again.']);
    expect((await c.log()).some((m) => m.method === 'session/prompt')).toBe(false);
  });

  it('sends the options again on a config_option_update during the reply', async () => {
    const c = await setup();
    const { events } = await chat(c, { ...base, prompt: 'OPTIONUPDATE' });
    const values = snapshots(events).map((s) => s.options[0].currentValue);
    expect(values[0]).toBe('on');
    expect(values.at(-1)).toBe('off');
    expect(contentOf(events)).toBe('echo: OPTIONUPDATE');
  });
});

const postModels = (c: Setup, body?: unknown) =>
  fetch(`${c.url}/api/kiro/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

describe('POST /api/kiro/models', () => {
  it('lists the models, answers 401 when signed out, and 405 for GET', async () => {
    const c = await setup();
    const res = await postModels(c, {});
    expect(res.status).toBe(200);
    const { models, sessionOptions } = (await res.json()) as {
      models: { id: string }[];
      sessionOptions?: Snapshot;
    };
    expect(models.map((m) => m.id)).toEqual(['auto', 'claude-fake-1', 'think-fake']);
    // Kiro's defaults for a new chat (K9)
    expect(sessionOptions?.mode?.currentValue).toBe('vibe');
    expect(sessionOptions?.options.map((o) => `${o.id}=${o.currentValue}`)).toEqual([
      'autopilot=on',
    ]);
    expect(models[1]).toMatchObject({
      name: 'Claude Fake 1',
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffortLevel: 'medium',
    });
    const log = await c.log();
    expect(log.filter((m) => m.method === 'session/new')).toHaveLength(1);
    expect(log.filter((m) => m.method === 'session/delete')).toHaveLength(1);

    // Cached: no new session, also with an empty body
    expect((await postModels(c)).status).toBe(200);
    expect((await c.log()).filter((m) => m.method === 'session/new')).toHaveLength(1);

    // refresh loads them again
    expect((await postModels(c, { refresh: true })).status).toBe(200);
    expect((await c.log()).filter((m) => m.method === 'session/new')).toHaveLength(2);

    expect(await postModels(c, 'x').then((r) => r.status)).toBe(200);
    const bad = await fetch(`${c.url}/api/kiro/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(bad.status).toBe(400);

    c.status.current = SIGNED_OUT;
    const signedOut = await postModels(c, {});
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: 'Not signed in to Kiro', code: 'signed-out' });

    c.status.current = { state: 'not-installed' };
    const missing = await postModels(c, {});
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ models: [] });

    // No GET may change state: GET and HEAD are refused
    for (const method of ['GET', 'HEAD']) {
      const res = await fetch(`${c.url}/api/kiro/models`, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
    expect((await c.log()).filter((m) => m.method === 'session/new')).toHaveLength(2);
  });

  it('sends plain text for a failed list', async () => {
    const c = await setup();
    c.status.current = { state: 'error', path: '~/x', message: 'spawn failed at /some/path' };
    const res = await postModels(c, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Kiro could not list its models. See the terminal that runs npm run dev.',
    });
  });
});

describe('isPromptEcho', () => {
  it("is true for Kiro's first title, the start of the prompt", () => {
    const prompt = 'Remember the word "lighthouse" for later. Reply with one short sentence.';
    expect(
      isPromptEcho(
        'Remember the word "lighthouse" for later. Reply with one short sentence',
        prompt
      )
    ).toBe(true);
    expect(isPromptEcho('remember the word  "lighthouse"', prompt)).toBe(true);
  });

  it('is false for a short title of its own', () => {
    expect(
      isPromptEcho('Remembering Lighthouse', 'Remember the word "lighthouse" for later.')
    ).toBe(false);
    expect(isPromptEcho('', 'x')).toBe(false);
  });
});
