// @vitest-environment node
// The generic ACP session calls (session/list, a load with replay, session/close) with the
// minimal fake agent: no product code at all.
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcpAgent } from '../acp/agent.ts';
import type { AcpAgentOptions } from '../acp/agent.ts';
import type { AcpHarness, AgentErrorKind } from '../acp/harness.ts';
import type { SessionUpdate } from '../acp/types.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-acp-agent.mjs'
);

class TestError extends Error {
  readonly kind: AgentErrorKind;
  constructor(kind: AgentErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

interface TestInfo {
  updates?: number;
}

let root: string;
let counter = 0;
const agents: AcpAgent<TestInfo>[] = [];

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'acp-agent-test-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.stop()));
  vi.restoreAllMocks();
});

function setup(
  env: Record<string, string> = {},
  options: AcpAgentOptions = {},
  extra: Partial<AcpHarness<TestInfo>> = {}
) {
  counter += 1;
  const logFile = path.join(root, `messages-${counter}.log`);
  const harness: AcpHarness<TestInfo> = {
    names: { agent: 'Test', cli: 'Test CLI', log: 'test' },
    launch: async () => ({
      command: process.execPath,
      args: [FAKE, '--fake-acp'],
      cwd: root,
      env: { PATH: '', FAKE_ACP_LOG: logFile, ...env },
    }),
    workspaceDir: async () => root,
    signedOut: (init) => init?.authMethods?.some((m) => m.id === 'test-login') === true,
    isSignedOutError: () => false,
    createError: (kind, message) => new TestError(kind, message),
    extensionMethods: ['_test/ping'],
    sessionInfo: {
      fromUpdate: (_update, info) => {
        info.updates = (info.updates ?? 0) + 1;
      },
      fromLoad: () => undefined,
    },
    ...extra,
  };
  const agent = new AcpAgent(harness, {
    stopTimings: { graceMs: 200, killMs: 1000 },
    ...options,
    timeouts: { cancelWait: 2000, ...options.timeouts },
  });
  agents.push(agent);
  return {
    agent,
    async log(): Promise<Record<string, unknown>[]> {
      try {
        const text = await readFile(logFile, 'utf8');
        return text
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Record<string, unknown>);
      } catch {
        return [];
      }
    },
  };
}

const text = (t: string) => [{ type: 'text' as const, text: t }];
const collect = () => {
  const updates: SessionUpdate[] = [];
  return { updates, onUpdate: (u: SessionUpdate) => void updates.push(u) };
};

const loadMeta = { noReplay: true };
const sessionsSetup = (options: AcpAgentOptions = {}) =>
  setup({ FAKE_ACP_SESSIONS: '1' }, options, { loadMeta });
const methods = async (c: ReturnType<typeof setup>) => (await c.log()).map((m) => m.method);
const chunkText = (u: SessionUpdate) => (u.content as { text: string }).text;

describe('AcpAgent session calls', () => {
  it('lists the sessions that the agent returns', async () => {
    const c = sessionsSetup();
    const result = await c.agent.listSessions();
    expect(result.sessions).toEqual([
      { sessionId: 'old-1', cwd: '/tmp/fake-acp', title: 'Old', updatedAt: '2026-01-01' },
    ]);
    const call = (await c.log()).find((m) => m.method === 'session/list');
    expect(call?.params).toEqual({});
  });

  it('refuses to list without the agent capability', async () => {
    const c = setup();
    await expect(c.agent.listSessions()).rejects.toThrow(
      new TestError('session', 'Test CLI cannot list sessions')
    );
    expect(await methods(c)).not.toContain('session/list');
  });

  it('gives the other notifications to the listeners until they unsubscribe', async () => {
    const c = sessionsSetup();
    const seen: string[] = [];
    const off = c.agent.onAgentNotification((method) => seen.push(method));
    await c.agent.listSessions();
    await vi.waitFor(() => expect(seen).toEqual(['_test/changed']));
    off();
    await c.agent.listSessions();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual(['_test/changed']);
  });

  it('replays a session before the load answers, then closes it', async () => {
    const c = sessionsSetup();
    const { updates, onUpdate } = collect();
    const result = await c.agent.replaySession('old-1', '/tmp/fake-acp', onUpdate);
    expect(result._meta).toEqual({ title: 'Old' });
    expect(updates.map(chunkText)).toEqual(['earlier one', 'earlier two']);
    const log = await c.log();
    const load = log.find((m) => m.method === 'session/load');
    // No `_meta`: the agent replays
    expect(load?.params).toEqual({ sessionId: 'old-1', cwd: '/tmp/fake-acp', mcpServers: [] });
    expect(log.map((m) => m.method).slice(-2)).toEqual(['session/load', 'session/close']);
    expect((log.at(-1)?.params as { sessionId: string }).sessionId).toBe('old-1');
    expect(c.agent.isLive('old-1')).toBe(false);
    expect(c.agent.state().liveSessions).toBe(0);
    // An update after the answer does not reach the replay
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(updates).toHaveLength(2);
  });

  it('closes a live session before it replays it, and a later ensureSession loads it again', async () => {
    const c = sessionsSetup();
    const { sessionId } = await c.agent.newSession();
    const { updates, onUpdate } = collect();
    await c.agent.replaySession(sessionId, root, onUpdate);
    expect(updates).toHaveLength(2);
    expect(c.agent.isLive(sessionId)).toBe(false);
    expect(await methods(c)).toEqual([
      'initialize',
      'session/new',
      'session/close',
      'session/load',
      'session/close',
    ]);
    await c.agent.ensureSession(sessionId, root);
    expect(c.agent.isLive(sessionId)).toBe(true);
    const loads = (await c.log()).filter((m) => m.method === 'session/load');
    expect(loads.at(-1)?.params).toEqual({ sessionId, cwd: root, mcpServers: [], _meta: loadMeta });
  });

  it('closeSession closes a live session; the session loads again for the next prompt', async () => {
    const c = sessionsSetup();
    const { sessionId } = await c.agent.newSession();
    await c.agent.closeSession(sessionId);
    expect(c.agent.isLive(sessionId)).toBe(false);
    const close = (await c.log()).find((m) => m.method === 'session/close');
    expect(close?.params).toEqual({ sessionId });
    await expect(c.agent.prompt(sessionId, text('hi'), collect())).rejects.toThrow(
      'The Test session is not open'
    );
    await c.agent.ensureSession(sessionId, root);
    expect(await c.agent.prompt(sessionId, text('hi'), collect())).toBe('end_turn');
  });

  it('closeSession sends nothing for a session that is not open here', async () => {
    const c = sessionsSetup();
    await c.agent.listSessions();
    await c.agent.closeSession('old-1');
    expect(await methods(c)).not.toContain('session/close');
  });

  it('closeSession sends nothing without the agent capability', async () => {
    const c = setup();
    const { sessionId } = await c.agent.newSession();
    await c.agent.closeSession(sessionId);
    expect(await methods(c)).not.toContain('session/close');
    expect(c.agent.isLive(sessionId)).toBe(true);
  });

  it('refuses to close or replay a session while a prompt runs in it', async () => {
    const c = sessionsSetup();
    const { sessionId } = await c.agent.newSession();
    const controller = new AbortController();
    const reply = c.agent.prompt(sessionId, text('WAIT'), {
      onUpdate: () => undefined,
      signal: controller.signal,
    });
    const busy = new TestError('busy', 'Test is still answering in this chat');
    await expect(c.agent.closeSession(sessionId)).rejects.toThrow(busy);
    await expect(c.agent.replaySession(sessionId, root, () => undefined)).rejects.toThrow(busy);
    controller.abort();
    expect(await reply).toBe('cancelled');
    expect(await methods(c)).not.toContain('session/close');
  });

  it('refuses a second replay of the same session while one runs', async () => {
    const c = sessionsSetup();
    const first = c.agent.replaySession('old-1', '/tmp/fake-acp', () => undefined);
    await expect(c.agent.replaySession('old-1', '/tmp/fake-acp', () => undefined)).rejects.toThrow(
      new TestError('busy', 'Test is still answering in this chat')
    );
    await first;
  });
});
