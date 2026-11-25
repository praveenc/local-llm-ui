// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer, request as httpRequest } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIRO_DENIED_TOOL, KIRO_STOP_NOTICES } from '../../src/utils/kiroChat.ts';
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
  opts: { env?: Record<string, string>; busyWaitMs?: number } = {}
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
    .filter((p) => p.configId !== 'autopilot')
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

  it('denies a permission request with reject_once and says so on the tool', async () => {
    const c = await setup();
    const { events } = await chat(c, { ...base, prompt: 'TOOL' });
    const [call] = ofKind(events, 'toolCall') as { id: string; name: string; args: unknown }[];
    expect(call).toEqual({
      id: expect.stringMatching(/^run_command_/) as string,
      name: 'execute',
      args: { command: 'echo hi > hello.txt' },
    });
    expect(ofKind(events, 'toolResult')).toEqual([
      { id: call.id, name: 'execute', error: KIRO_DENIED_TOOL },
    ]);
    const answer = (await c.log()).find(
      (m) => m.method === undefined && (m.result as { outcome?: unknown })?.outcome
    );
    expect(answer?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'o2' } });
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
    const { models } = (await res.json()) as { models: { id: string }[] };
    expect(models.map((m) => m.id)).toEqual(['auto', 'claude-fake-1', 'think-fake']);
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
