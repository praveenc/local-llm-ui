// @vitest-environment node
import { spawn } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionUpdate } from '../acp/types.ts';
import {
  KiroAgent,
  KiroBusyError,
  KiroCancelTimeoutError,
  KiroCrashedError,
  KiroError,
  KiroNotInstalledError,
  KiroOptionError,
  KiroSessionError,
  KiroSignedOutError,
  getKiroAgent,
  optionIdForKind,
  shutdownKiroAgent,
} from '../kiro/agent.ts';
import type { KiroAgentOptions, PermissionQuestion } from '../kiro/agent.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-kiro-acp.mjs'
);

let root: string;
let binary: string;
let counter = 0;
const agents: KiroAgent[] = [];

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kiro-agent-test-'));
  binary = path.join(root, 'kiro-cli');
  // An absolute shebang: the fake runs without a shell and without PATH
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
  await Promise.all(agents.splice(0).map((a) => a.stop()));
  vi.restoreAllMocks();
});

interface Case {
  agent: KiroAgent;
  dir: string;
  log(): Promise<{ pid: number; msg: Record<string, unknown> }[]>;
  pids(): Promise<{ pid: number; grandchild?: number }>;
}

async function caseDir() {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  const home = path.join(dir, 'home');
  await mkdir(home, { recursive: true });
  const logFile = path.join(dir, 'messages.log');
  const pidsFile = path.join(dir, 'pids.json');
  const env = {
    HOME: home,
    PATH: '',
    LOCAL_LLM_UI_KIRO_CLI: binary,
    FAKE_KIRO_LOG: logFile,
    FAKE_KIRO_PIDS: pidsFile,
    FAKE_KIRO_STATE_DIR: dir,
  };
  return { dir, home, logFile, pidsFile, env };
}

async function setup(
  env: Record<string, string> = {},
  options: KiroAgentOptions = {}
): Promise<Case> {
  const { dir, home, logFile, pidsFile, env: base } = await caseDir();
  const agent = new KiroAgent({
    environment: {
      env: { ...base, ...env },
      home,
      platform: 'linux',
    },
    stopTimings: { graceMs: 200, killMs: 1000 },
    ...options,
    timeouts: { cancelWait: 2000, ...options.timeouts },
  });
  agents.push(agent);
  return {
    agent,
    dir,
    async log() {
      try {
        const text = await readFile(logFile, 'utf8');
        return text
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { pid: number; msg: Record<string, unknown> });
      } catch {
        return [];
      }
    },
    async pids() {
      return JSON.parse(await readFile(pidsFile, 'utf8')) as { pid: number; grandchild?: number };
    },
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

const text = (t: string) => [{ type: 'text' as const, text: t }];
const methods = (log: { msg: Record<string, unknown> }[]) =>
  log.map((l) => l.msg.method).filter(Boolean);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const collect = () => {
  const updates: SessionUpdate[] = [];
  return { updates, onUpdate: (u: SessionUpdate) => void updates.push(u) };
};

describe('KiroAgent start', () => {
  it('throws KiroSignedOutError when signed out and leaves no process', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'signed-out' });
    await expect(c.agent.newSession()).rejects.toBeInstanceOf(KiroSignedOutError);
    const { pid } = await c.pids();
    expect(alive(pid)).toBe(false);
    expect(c.agent.state().running).toBe(false);
    expect(methods(await c.log())).toEqual(['initialize']);
  });

  it('throws KiroNotInstalledError without a binary', async () => {
    const c = await setup({}, { resolveBinary: async () => null });
    await expect(c.agent.newSession()).rejects.toBeInstanceOf(KiroNotInstalledError);
  });

  it('shares one start between concurrent callers and creates the workspace folder', async () => {
    const workspaceDir = path.join(root, `ws-${counter + 1}`, 'kiro');
    const c = await setup({}, { workspaceDir });
    const sessions = await Promise.all([
      c.agent.newSession(),
      c.agent.newSession(),
      c.agent.newSession(),
    ]);
    expect(new Set(sessions.map((s) => s.sessionId)).size).toBe(3);
    const log = await c.log();
    expect(log.filter((l) => l.msg.method === 'initialize')).toHaveLength(1);
    expect(new Set(log.map((l) => l.pid)).size).toBe(1);
    expect((await stat(workspaceDir)).mode & 0o777).toBe(0o700);
    const init = log.find((l) => l.msg.method === 'initialize')!.msg.params;
    expect(init).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'local-llm-ui' },
    });
    const created = log.find((l) => l.msg.method === 'session/new')!.msg.params;
    expect(created).toEqual({ cwd: workspaceDir, mcpServers: [] });
  });

  it('retries session/new once on a new process after a timeout', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'hang-new' }, { timeouts: { newSession: 300 } });
    const { sessionId } = await c.agent.newSession();
    expect(sessionId).toMatch(/^sess_/);
    const log = await c.log();
    const pids = [...new Set(log.filter((l) => l.msg.method === 'initialize').map((l) => l.pid))];
    expect(pids).toHaveLength(2);
    expect(alive(pids[0])).toBe(false);
    expect(c.agent.state().pid).toBe(pids[1]);
  });
});

describe('KiroAgent sessions', () => {
  it('turns Autopilot off and reads it back', async () => {
    const c = await setup();
    const { sessionId, configOptions } = await c.agent.newSession();
    expect(configOptions.find((o) => o.id === 'autopilot')?.currentValue).toBe('off');
    expect(c.agent.configOptions(sessionId)?.find((o) => o.id === 'autopilot')?.currentValue).toBe(
      'off'
    );
    const set = (await c.log()).find((l) => l.msg.method === 'session/set_config_option');
    expect(set?.msg.params).toEqual({ sessionId, configId: 'autopilot', value: 'off' });
  });

  it('deletes the session when Autopilot stays on', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'autopilot-stuck' });
    await expect(c.agent.newSession()).rejects.toThrow(
      new KiroSessionError('Kiro did not turn off Autopilot')
    );
    const log = await c.log();
    expect(methods(log)).toContain('session/delete');
    expect(c.agent.state().liveSessions).toBe(0);
  });

  it('sets only listed options and values, and checks the value read back', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    await expect(c.agent.setOption(sessionId, 'nope', 'x')).rejects.toBeInstanceOf(KiroOptionError);
    await expect(c.agent.setOption(sessionId, 'model', 'gpt-0')).rejects.toBeInstanceOf(
      KiroOptionError
    );
    await expect(c.agent.setOption(sessionId, 'model', 'stuck-model')).rejects.toBeInstanceOf(
      KiroOptionError
    );
    const options = await c.agent.setOption(sessionId, 'model', 'claude-fake-1');
    expect(options.find((o) => o.id === 'model')?.currentValue).toBe('claude-fake-1');
    const sets = (await c.log()).filter((l) => l.msg.method === 'session/set_config_option');
    // autopilot, stuck-model, claude-fake-1: the invalid ones were never sent
    expect(sets.map((s) => (s.msg.params as { value: string }).value)).toEqual([
      'off',
      'stuck-model',
      'claude-fake-1',
    ]);
  });

  it('holds two sessions on one process and routes concurrent replies', async () => {
    const c = await setup();
    const a = await c.agent.newSession();
    const b = await c.agent.newSession();
    expect(c.agent.state()).toMatchObject({ running: true, liveSessions: 2 });
    const ua = collect();
    const ub = collect();
    const [ra, rb] = await Promise.all([
      c.agent.prompt(a.sessionId, text('SLOW alpha'), { onUpdate: ua.onUpdate }),
      c.agent.prompt(b.sessionId, text('SLOW beta'), { onUpdate: ub.onUpdate }),
    ]);
    expect([ra, rb]).toEqual(['end_turn', 'end_turn']);
    const reply = (u: SessionUpdate[], kind: string) =>
      u
        .filter((x) => x.sessionUpdate === kind)
        .map((x) => (x as { content: { text: string } }).content.text)
        .join('');
    expect(reply(ua.updates, 'agent_message_chunk')).toBe('echo: SLOW alpha');
    expect(reply(ub.updates, 'agent_message_chunk')).toBe('echo: SLOW beta');
    expect(reply(ua.updates, 'agent_thought_chunk')).toBe(`thinking about ${a.sessionId}`);
    expect(reply(ub.updates, 'agent_thought_chunk')).toBe(`thinking about ${b.sessionId}`);
    const kinds = ua.updates
      .filter((u) => u.sessionUpdate === 'session_info_update')
      .map((u) => (u._meta as { kiro: { kind: string } }).kiro.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['turn_completion', 'context_usage', 'focus_update'])
    );
    expect(new Set((await c.log()).map((l) => l.pid)).size).toBe(1);
  });

  it('allows one prompt per session, and cancel ends it with cancelled', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    const first = c.agent.prompt(sessionId, text('WAIT'), collect());
    await expect(c.agent.prompt(sessionId, text('again'), collect())).rejects.toBeInstanceOf(
      KiroBusyError
    );
    await sleep(30);
    await c.agent.cancel(sessionId);
    expect(await first).toBe('cancelled');
    expect(methods(await c.log())).toContain('session/cancel');
    // The session can answer again
    expect(await c.agent.prompt(sessionId, text('hi'), collect())).toBe('end_turn');
  });

  it('cancels when the signal aborts', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    const controller = new AbortController();
    const reply = c.agent.prompt(sessionId, text('WAIT'), {
      ...collect(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    expect(await reply).toBe('cancelled');
  });

  it('rejects a prompt on a session that is not live', async () => {
    const c = await setup();
    await expect(c.agent.prompt('sess_x', text('hi'), collect())).rejects.toBeInstanceOf(
      KiroSessionError
    );
  });

  it('deletes a session', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    await c.agent.deleteSession(sessionId);
    expect(c.agent.isLive(sessionId)).toBe(false);
    expect(methods(await c.log())).toContain('session/delete');
  });
});

describe('KiroAgent permissions', () => {
  const answers = async (c: Case) =>
    (await c.log())
      .filter((l) => l.msg.method === undefined && l.msg.id !== undefined)
      .map((l) => l.msg.result);
  const toolStatus = (updates: SessionUpdate[]) =>
    updates.find((u) => u.sessionUpdate === 'tool_call_update')?.status;

  it('denies by default with the reject_once option', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    const u = collect();
    expect(await c.agent.prompt(sessionId, text('TOOL'), u)).toBe('end_turn');
    expect(await answers(c)).toEqual([{ outcome: { outcome: 'selected', optionId: 'o2' } }]);
    expect(toolStatus(u.updates)).toBe('failed');
  });

  it('chooses the option by kind', async () => {
    const handler = vi.fn(({ request }) => ({ optionId: optionIdForKind(request, 'allow_once')! }));
    const c = await setup({}, { permissionHandler: handler });
    const { sessionId } = await c.agent.newSession();
    const u = collect();
    await c.agent.prompt(sessionId, text('TOOL'), u);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, signal: expect.any(AbortSignal) })
    );
    expect(await answers(c)).toEqual([{ outcome: { outcome: 'selected', optionId: 'o3' } }]);
    expect(toolStatus(u.updates)).toBe('completed');
  });

  it('denies when the handler throws or names an unknown option', async () => {
    let call = 0;
    const c = await setup(
      {},
      {
        permissionHandler: () => {
          call += 1;
          if (call === 1) throw new Error('boom');
          return { optionId: 'not-listed' };
        },
      }
    );
    const { sessionId } = await c.agent.newSession();
    await c.agent.prompt(sessionId, text('TOOL'), collect());
    await c.agent.prompt(sessionId, text('TOOL'), collect());
    expect(await answers(c)).toEqual([
      { outcome: { outcome: 'selected', optionId: 'o2' } },
      { outcome: { outcome: 'selected', optionId: 'o2' } },
    ]);
  });

  it('answers cancelled when the prompt is cancelled while the handler waits', async () => {
    const c = await setup(
      {},
      {
        permissionHandler: ({ signal }) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => resolve({ optionId: 'o3' }))
          ),
      }
    );
    const { sessionId } = await c.agent.newSession();
    const reply = c.agent.prompt(sessionId, text('TOOL'), collect());
    await sleep(100);
    await c.agent.cancel(sessionId);
    expect(await reply).toBe('cancelled');
    expect(await answers(c)).toEqual([{ outcome: { outcome: 'cancelled' } }]);
  });
});

describe('KiroAgent failures and stop', () => {
  it('stops the process when cancel is ignored, then reloads the session', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'ignore-cancel' }, { timeouts: { cancelWait: 200 } });
    const { sessionId } = await c.agent.newSession();
    const firstPid = c.agent.state().pid!;
    const reply = c.agent.prompt(sessionId, text('WAIT'), collect());
    const result = reply.catch((e: unknown) => e);
    await sleep(30);
    await c.agent.cancel(sessionId);
    expect(await result).toBeInstanceOf(KiroCancelTimeoutError);
    expect(c.agent.state().running).toBe(false);
    expect(alive(firstPid)).toBe(false);
    await c.agent.ensureSession(sessionId, c.dir);
    expect(c.agent.state().pid).not.toBe(firstPid);
    const load = (await c.log()).find((l) => l.msg.method === 'session/load');
    expect(load?.msg.params).toEqual({
      sessionId,
      cwd: c.dir,
      mcpServers: [],
      _meta: { kiro: { noReplay: true } },
    });
    // A live session needs no load
    await c.agent.ensureSession(sessionId, c.dir);
    expect(methods(await c.log()).filter((m) => m === 'session/load')).toHaveLength(1);
  });

  it('rejects with KiroCrashedError when Kiro exits during a reply, then loads again', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'crash-on-prompt' });
    const { sessionId } = await c.agent.newSession();
    await c.agent.setOption(sessionId, 'model', 'claude-fake-1');
    const firstPid = c.agent.state().pid!;
    const u = collect();
    await expect(c.agent.prompt(sessionId, text('hi'), u)).rejects.toBeInstanceOf(KiroCrashedError);
    expect(u.updates.length).toBeGreaterThan(0);
    expect(c.agent.isLive(sessionId)).toBe(false);
    await vi.waitFor(() => expect(c.agent.state().lastExit?.code).toBe(3));
    await c.agent.ensureSession(sessionId, c.dir);
    expect(c.agent.state().pid).not.toBe(firstPid);
    // The model that the user set comes back after the load
    expect(c.agent.configOptions(sessionId)?.find((o) => o.id === 'model')?.currentValue).toBe(
      'claude-fake-1'
    );
    expect(c.agent.configOptions(sessionId)?.find((o) => o.id === 'autopilot')?.currentValue).toBe(
      'off'
    );
  });

  it('stops when idle and starts a new process on the next use', async () => {
    const c = await setup({}, { idleMs: 150 });
    await c.agent.newSession();
    const firstPid = c.agent.state().pid!;
    await vi.waitFor(() => expect(alive(firstPid)).toBe(false), { timeout: 3000 });
    expect(c.agent.state()).toMatchObject({ running: false, liveSessions: 0 });
    await c.agent.newSession();
    expect(c.agent.state().pid).not.toBe(firstPid);
  });

  it('does not stop for idle while a reply runs', async () => {
    const c = await setup({}, { idleMs: 100 });
    const { sessionId } = await c.agent.newSession();
    const reply = c.agent.prompt(sessionId, text('WAIT'), collect());
    await sleep(300);
    expect(c.agent.state().running).toBe(true);
    await c.agent.cancel(sessionId);
    expect(await reply).toBe('cancelled');
  });

  it('stop() ends the child and a grandchild in its own process group', async () => {
    const c = await setup({ FAKE_KIRO_SPAWN_GRANDCHILD: '1' });
    await c.agent.newSession();
    const { pid, grandchild } = await c.pids();
    expect(grandchild).toBeGreaterThan(0);
    expect(alive(pid)).toBe(true);
    expect(alive(grandchild!)).toBe(true);
    await c.agent.stop();
    await c.agent.stop();
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    expect(() => process.kill(grandchild!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    expect(c.agent.state()).toMatchObject({ running: false, lastExit: { code: 0 } });
  });
});

const SIGNAL_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'kiro-agent-signal.ts'
);

const waitGone = (pid: number, timeout = 3000) =>
  vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout, interval: 25 });
const autopilot = (c: Case, sessionId: string) =>
  c.agent.configOptions(sessionId)?.find((o) => o.id === 'autopilot')?.currentValue;
const configSets = async (c: Case) =>
  (await c.log())
    .filter((l) => l.msg.method === 'session/set_config_option')
    .map((l) => l.msg.params as { configId: string; value: string });

describe('KiroAgent review fixes', () => {
  // B1
  it('never deletes a loaded session that fails the Autopilot check', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'autopilot-stuck' });
    await expect(c.agent.ensureSession('sess_existing', c.dir)).rejects.toThrow(
      new KiroSessionError('Kiro did not turn off Autopilot')
    );
    const log = methods(await c.log());
    expect(log).toContain('session/load');
    expect(log).not.toContain('session/delete');
    expect(c.agent.isLive('sess_existing')).toBe(false);
    expect(c.agent.state().liveSessions).toBe(0);
  });

  // M1
  it('stops the recorded process groups after a crash', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'crash-on-prompt', FAKE_KIRO_SPAWN_GRANDCHILD: '1' });
    const { sessionId } = await c.agent.newSession();
    const { pid, grandchild } = await c.pids();
    expect(alive(grandchild!)).toBe(true);
    await expect(c.agent.prompt(sessionId, text('hi'), collect())).rejects.toBeInstanceOf(
      KiroCrashedError
    );
    await waitGone(pid);
    await waitGone(grandchild!);
  });

  // M2
  it('cancels the reply and turns Autopilot off again when Kiro reports it on', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'autopilot-flip' });
    const { sessionId } = await c.agent.newSession();
    const pid = c.agent.state().pid;
    expect(await c.agent.prompt(sessionId, text('hi'), collect())).toBe('cancelled');
    expect(methods(await c.log())).toContain('session/cancel');
    await vi.waitFor(() => expect(c.agent.isLive(sessionId)).toBe(true));
    expect(autopilot(c, sessionId)).toBe('off');
    const offs = (await configSets(c)).filter((p) => p.configId === 'autopilot');
    expect(offs).toEqual([
      { sessionId, configId: 'autopilot', value: 'off' },
      { sessionId, configId: 'autopilot', value: 'off' },
    ]);
    expect(c.agent.state().pid).toBe(pid);
  });

  it('rejects changes to autopilot and mode', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    for (const [id, value] of [
      ['autopilot', 'on'],
      ['mode', 'vibe'],
    ]) {
      await expect(c.agent.setOption(sessionId, id, value)).rejects.toThrow(
        new KiroOptionError('This option cannot be changed from the app')
      );
    }
    expect((await configSets(c)).map((p) => p.value)).toEqual(['off']);
  });

  // M3
  it('answers cancelled at once on cancel when the handler never answers', async () => {
    const c = await setup({}, { permissionHandler: () => new Promise(() => undefined) });
    const { sessionId } = await c.agent.newSession();
    const pid = c.agent.state().pid;
    const reply = c.agent.prompt(sessionId, text('TOOL'), collect());
    await vi.waitFor(async () =>
      expect((await c.log()).some((l) => l.msg.method === 'session/prompt')).toBe(true)
    );
    await sleep(100);
    const start = Date.now();
    await c.agent.cancel(sessionId);
    expect(await reply).toBe('cancelled');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(c.agent.state()).toMatchObject({ running: true, pid });
    const answers = (await c.log())
      .filter((l) => l.msg.method === undefined && l.msg.id !== undefined)
      .map((l) => l.msg.result);
    expect(answers).toEqual([{ outcome: { outcome: 'cancelled' } }]);
  });

  it('answers reject_once when the handler does not answer in time', async () => {
    const c = await setup(
      {},
      { permissionHandler: () => new Promise(() => undefined), permissionTimeoutMs: 200 }
    );
    const { sessionId } = await c.agent.newSession();
    const u = collect();
    expect(await c.agent.prompt(sessionId, text('TOOL'), u)).toBe('end_turn');
    const answers = (await c.log())
      .filter((l) => l.msg.method === undefined && l.msg.id !== undefined)
      .map((l) => l.msg.result);
    expect(answers).toEqual([{ outcome: { outcome: 'selected', optionId: 'o2' } }]);
    expect(u.updates.find((x) => x.sessionUpdate === 'tool_call_update')?.status).toBe('failed');
  });

  // M4
  it('does not restart for a slow session/new while another session is live', async () => {
    const c = await setup(
      { FAKE_KIRO_MODE: 'hang-new', FAKE_KIRO_HANG_NEW_AT: '2' },
      { timeouts: { newSession: 300 } }
    );
    const first = await c.agent.newSession();
    const pid = c.agent.state().pid;
    await expect(c.agent.newSession()).rejects.toThrow(
      new KiroSessionError('Kiro is slow to open a chat. Try again.')
    );
    expect(c.agent.state().pid).toBe(pid);
    expect(c.agent.isLive(first.sessionId)).toBe(true);
    expect(methods(await c.log()).filter((m) => m === 'initialize')).toHaveLength(1);
  });

  // M5
  it('kills Kiro and its groups when the app gets SIGINT', async () => {
    const { home, env, pidsFile } = await caseDir();
    const child = spawn(process.execPath, ['--experimental-strip-types', SIGNAL_SCRIPT], {
      // The app needs PATH for `ps`
      env: { ...env, HOME: home, PATH: process.env.PATH ?? '', FAKE_KIRO_SPAWN_GRANDCHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<NodeJS.Signals | null>((resolve) =>
      child.once('exit', (_code, signal) => resolve(signal))
    );
    try {
      await new Promise<void>((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString();
          if (out.includes('ready')) resolve();
        });
        child.once('exit', () => reject(new Error('the child ended before it was ready')));
      });
      const { pid, grandchild } = JSON.parse(await readFile(pidsFile, 'utf8')) as {
        pid: number;
        grandchild: number;
      };
      expect(alive(pid)).toBe(true);
      expect(alive(grandchild)).toBe(true);
      child.kill('SIGINT');
      expect(await exited).toBe('SIGINT');
      await waitGone(pid);
      await waitGone(grandchild);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  // minor: stop() and close()
  it('stop() during a session/new retry leaves no process', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'hang-new' }, { timeouts: { newSession: 300 } });
    const created = c.agent.newSession().catch((e: unknown) => e);
    await vi.waitFor(() => readFile(path.join(c.dir, 'hung-once'), 'utf8'));
    await sleep(320);
    await c.agent.stop();
    await created;
    await sleep(100);
    expect(c.agent.state().running).toBe(false);
    const pids = [...new Set((await c.log()).map((l) => l.pid))];
    for (const pid of pids) expect(alive(pid)).toBe(false);
  });

  it('close() and shutdownKiroAgent() stop for good', async () => {
    const c = await setup();
    await c.agent.newSession();
    const pid = c.agent.state().pid!;
    await c.agent.close();
    expect(alive(pid)).toBe(false);
    await expect(c.agent.newSession()).rejects.toThrow(new KiroError('Kiro is stopping'));

    const shared = getKiroAgent();
    await shutdownKiroAgent();
    await expect(shared.newSession()).rejects.toThrow(new KiroError('Kiro is stopping'));
    // A new server in the same process gets a new agent
    expect(getKiroAgent()).not.toBe(shared);
    await shutdownKiroAgent();
  });

  // minor: workspace folder
  it('sets mode 0700 on an existing workspace folder', async () => {
    const workspaceDir = path.join(root, `ws-open-${counter + 1}`);
    await mkdir(workspaceDir, { recursive: true, mode: 0o755 });
    await chmod(workspaceDir, 0o755);
    const c = await setup({}, { workspaceDir });
    await c.agent.newSession();
    const info = await stat(workspaceDir);
    expect(info.mode & 0o777).toBe(0o700);
    expect(info.uid).toBe(process.getuid?.());
  });

  // minor: ensureSession
  it('ensureSession on a live session refreshes the idle timer', async () => {
    const c = await setup({}, { idleMs: 300 });
    const { sessionId } = await c.agent.newSession();
    const pid = c.agent.state().pid;
    await sleep(200);
    await c.agent.ensureSession(sessionId, c.dir);
    await sleep(200);
    expect(c.agent.state().pid).toBe(pid);
    expect(await c.agent.prompt(sessionId, text('hi'), collect())).toBe('end_turn');
  });

  it('shares one session/load between concurrent ensureSession calls', async () => {
    const c = await setup();
    await Promise.all([
      c.agent.ensureSession('sess_a', c.dir),
      c.agent.ensureSession('sess_a', c.dir),
      c.agent.ensureSession('sess_a', c.dir),
    ]);
    expect(methods(await c.log()).filter((m) => m === 'session/load')).toHaveLength(1);
    expect(c.agent.isLive('sess_a')).toBe(true);
  });

  it('deleteSession throws KiroBusyError while that session answers', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    const reply = c.agent.prompt(sessionId, text('WAIT'), collect());
    await expect(c.agent.deleteSession(sessionId)).rejects.toBeInstanceOf(KiroBusyError);
    await c.agent.cancel(sessionId);
    expect(await reply).toBe('cancelled');
    expect(methods(await c.log())).not.toContain('session/delete');
  });

  it('isBusy, waitForIdle, and setOption while a reply runs or is cancelling', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    expect(c.agent.isBusy(sessionId)).toBe(false);
    expect(await c.agent.waitForIdle(sessionId, 10)).toBe(true);
    const reply = c.agent.prompt(sessionId, text('WAIT'), collect());
    expect(c.agent.isBusy(sessionId)).toBe(true);
    await expect(c.agent.setOption(sessionId, 'model', 'claude-fake-1')).rejects.toBeInstanceOf(
      KiroBusyError
    );
    expect(await c.agent.waitForIdle(sessionId, 50)).toBe(false);
    // A cancel that is ending still counts as busy until the reply ends
    void c.agent.cancel(sessionId);
    expect(c.agent.isBusy(sessionId)).toBe(true);
    expect(await c.agent.waitForIdle(sessionId, 2000)).toBe(true);
    expect(await reply).toBe('cancelled');
    expect(c.agent.isBusy(sessionId)).toBe(false);
    await c.agent.setOption(sessionId, 'model', 'claude-fake-1');
  });

  // minor: initialize checks
  it('maps -32000 Authentication required to KiroSignedOutError', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'auth-required' });
    await expect(c.agent.newSession()).rejects.toBeInstanceOf(KiroSignedOutError);
  });

  it('throws KiroSessionError when Kiro cannot load sessions', async () => {
    const c = await setup({ FAKE_KIRO_MODE: 'no-load' });
    await expect(c.agent.newSession()).rejects.toThrow(
      new KiroSessionError('This Kiro CLI cannot load sessions')
    );
    expect(c.agent.state().running).toBe(false);
    const { pid } = await c.pids();
    await waitGone(pid);
  });
});

describe('KiroAgent API for K5 and K6', () => {
  it('sessionInfo keeps context, title, and credits, also outside prompts', async () => {
    const c = await setup();
    expect(c.agent.sessionInfo('sess_x')).toBeUndefined();
    const { sessionId } = await c.agent.newSession();
    await vi.waitFor(() => expect(c.agent.sessionInfo(sessionId)?.contextPercent).toBe(1.5));
    await c.agent.prompt(sessionId, text('hi'), collect());
    expect(c.agent.sessionInfo(sessionId)).toEqual({
      contextPercent: 4.2,
      title: 'Fake title',
      credits: 0.05,
    });

    await c.agent.ensureSession('sess_loaded', c.dir);
    expect(c.agent.sessionInfo('sess_loaded')).toEqual({ contextPercent: 3.5 });
  });

  it('prompt onPermission gets the question and its answer is sent', async () => {
    const c = await setup();
    const { sessionId } = await c.agent.newSession();
    const questions: PermissionQuestion[] = [];
    const u = collect();
    const result = await c.agent.prompt(sessionId, text('TOOL'), {
      onUpdate: u.onUpdate,
      onPermission: (q) => {
        questions.push(q);
        return { optionId: q.options.find((o) => o.kind === 'allow_once')!.optionId };
      },
    });
    expect(result).toBe('end_turn');
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      toolCallId: expect.stringMatching(/^run_command_/),
      title: 'echo hi > hello.txt',
      signal: expect.any(AbortSignal),
    });
    expect(questions[0].options.map((o) => o.kind)).toEqual([
      'allow_always',
      'reject_once',
      'allow_once',
      'reject_always',
    ]);
    expect(u.updates.find((x) => x.sessionUpdate === 'tool_call_update')?.status).toBe('completed');
  });

  it('extension() calls only the allowed Kiro methods', async () => {
    const c = await setup();
    await expect(
      c.agent.extension<{ data: { planName: string } }>('_kiro/account/getUsage', {})
    ).resolves.toMatchObject({ success: true, data: { planName: 'FAKE' } });
    await expect(c.agent.extension('_kiro/other', {})).rejects.toBeInstanceOf(KiroError);
    expect(methods(await c.log())).not.toContain('_kiro/other');
  });

  it('ensureSession applies only the options that the session lists', async () => {
    const c = await setup();
    await c.agent.ensureSession('sess_opts', c.dir, {
      options: { model: 'claude-fake-1', nope: 'x', autopilot: 'on', mode: 'vibe' },
    });
    expect(c.agent.configOptions('sess_opts')?.find((o) => o.id === 'model')?.currentValue).toBe(
      'claude-fake-1'
    );
    expect(autopilot(c, 'sess_opts')).toBe('off');
    expect((await configSets(c)).map((p) => [p.configId, p.value])).toEqual([
      ['autopilot', 'off'],
      ['model', 'claude-fake-1'],
    ]);
  });
});
