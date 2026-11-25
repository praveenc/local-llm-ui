// @vitest-environment node
// The generic ACP agent with a tiny test harness and a minimal fake agent: no Kiro code at all.
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

describe('AcpAgent without the Kiro adapter', () => {
  it('starts the agent and runs one prompt', async () => {
    const c = setup();
    const { sessionId } = await c.agent.newSession();
    expect(c.agent.isLive(sessionId)).toBe(true);
    const { updates, onUpdate } = collect();
    expect(await c.agent.prompt(sessionId, text('hi'), { onUpdate })).toBe('end_turn');
    expect(updates.map((u) => u.sessionUpdate)).toEqual(['agent_message_chunk']);
    const init = (await c.log()).find((m) => m.method === 'initialize');
    expect(init?.params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'local-llm-ui' },
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[test\] agent started pid/));
  });

  it('denies a permission by default with reject_once', async () => {
    const c = setup();
    const { sessionId } = await c.agent.newSession();
    const { updates, onUpdate } = collect();
    expect(await c.agent.prompt(sessionId, text('TOOL'), { onUpdate })).toBe('end_turn');
    const answer = (await c.log()).find((m) => m.id !== undefined && m.method === undefined);
    expect(answer?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(updates.at(-1)).toMatchObject({ sessionUpdate: 'tool_call_update', status: 'failed' });
  });

  it('ends a cancelled prompt with cancelled', async () => {
    const c = setup();
    const { sessionId } = await c.agent.newSession();
    const controller = new AbortController();
    const reply = c.agent.prompt(sessionId, text('WAIT'), {
      onUpdate: () => controller.abort(),
      signal: controller.signal,
    });
    expect(await reply).toBe('cancelled');
    expect((await c.log()).some((m) => m.method === 'session/cancel')).toBe(true);
    expect(c.agent.isBusy(sessionId)).toBe(false);
  });

  it('calls only the harness extension methods', async () => {
    const c = setup();
    expect(await c.agent.extension('_test/ping', {})).toEqual({ pong: true });
    await expect(c.agent.extension('_test/other', {})).rejects.toThrow(
      new TestError('agent', 'The app does not call _test/other')
    );
    expect((await c.log()).some((m) => m.method === '_test/other')).toBe(false);
  });

  it('refuses a signed-out agent through harness.signedOut', async () => {
    const c = setup({ FAKE_ACP_MODE: 'signed-out' });
    const error = await c.agent.newSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TestError);
    expect(error).toMatchObject({ kind: 'signed-out', message: 'Test CLI is not signed in' });
    expect(c.agent.state().running).toBe(false);
  });

  it('stops the process when harness.signedOut throws', async () => {
    const c = setup(
      {},
      {},
      {
        signedOut: () => {
          throw new TestError('agent', 'signedOut broke');
        },
      }
    );
    await expect(c.agent.newSession()).rejects.toThrow('signedOut broke');
    expect(c.agent.state().running).toBe(false);
  });

  it('drops the session and logs one line when a guard check fails', async () => {
    const c = setup(
      {},
      {},
      {
        guard: {
          isLocked: () => false,
          afterOpen: async () => undefined,
          check: () => Promise.reject(new Error('check broke')),
          refused: () => new TestError('option', 'Test refused the session'),
        },
      }
    );
    await expect(c.agent.newSession()).rejects.toThrow('Test refused the session');
    expect(console.warn).toHaveBeenCalledWith(
      '[test] session guard check failed, dropping the session'
    );
    expect(c.agent.isLive('s1')).toBe(false);
    await expect(c.agent.prompt('s1', text('hi'), collect())).rejects.toThrow(
      new TestError('session', 'The Test session is not open. Call ensureSession first.')
    );
  });

  it('has no option lock and no set_config_option without a guard', async () => {
    const c = setup();
    const { sessionId } = await c.agent.newSession();
    expect((await c.log()).some((m) => m.method === 'session/set_config_option')).toBe(false);
    await expect(c.agent.setOption(sessionId, 'autopilot', 'off')).rejects.toThrow(
      new TestError('option', 'Test has no option autopilot')
    );
  });

  it('keeps session info from the harness and loads a session again', async () => {
    const c = setup();
    const { sessionId } = await c.agent.newSession();
    expect(c.agent.sessionInfo(sessionId)).toEqual({});
    await c.agent.stop();
    expect(c.agent.isLive(sessionId)).toBe(false);
    await c.agent.ensureSession(sessionId, root);
    expect(c.agent.isLive(sessionId)).toBe(true);
    const load = (await c.log()).find((m) => m.method === 'session/load');
    expect(load?.params).toEqual({ sessionId, cwd: root, mcpServers: [] });
  });

  it('leaves no process after stop()', async () => {
    const c = setup();
    await c.agent.newSession();
    const pid = c.agent.state().pid!;
    expect(alive(pid)).toBe(true);
    await c.agent.stop();
    expect(c.agent.state().running).toBe(false);
    expect(alive(pid)).toBe(false);
  });
});
