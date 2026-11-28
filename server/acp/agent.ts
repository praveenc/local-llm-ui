/**
 * The shared agent process: one ACP agent process for all chats of one harness.
 *
 * It starts on the first use and stops after 10 idle minutes. One process holds many sessions.
 * After a crash, a stop, or an idle stop, a session is not live: `ensureSession` opens it again
 * with `session/load`. The harness's SessionGuard, if any, checks the config options of every
 * session.
 *
 * Logs lifecycle lines only. Never log prompt text, tool input, or the account.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

import { AcpClosedError, AcpConnection, AcpError, AcpTimeoutError } from './client.ts';
import type { AcpHarness, GuardContext } from './harness.ts';
import { answerPermission, denyPermission } from './permissions.ts';
import type {
  PermissionDecision,
  PermissionEnd,
  PermissionHandler,
  PromptPermissionHandler,
} from './permissions.ts';
import { recordProcessGroups, spawnAgentProcess, stopProcessTree } from './process.ts';
import type { AgentChild } from './process.ts';
import type {
  CloseSessionParams,
  ConfigOption,
  ContentBlock,
  InitializeParams,
  InitializeResult,
  ListSessionsParams,
  ListSessionsResult,
  LoadSessionParams,
  LoadSessionResult,
  Loose,
  NewSessionResult,
  PermissionOutcome,
  PermissionRequest,
  PromptResult,
  SessionNotification,
  SessionUpdate,
  SetConfigOptionResult,
  StopReason,
} from './types.ts';

export interface AgentTimeouts {
  initialize: number;
  newSession: number;
  loadSession: number;
  configOption: number;
  deleteSession: number;
  listSessions: number;
  closeSession: number;
  cancelWait: number;
}

/** A notification from the agent other than session/update, from any of its processes */
export type AgentNotificationListener = (method: string, params: unknown) => void;

export interface AcpAgentOptions {
  idleMs?: number;
  timeouts?: Partial<AgentTimeouts>;
  /** Default: deny (no tool runs without a question) */
  permissionHandler?: PermissionHandler;
  /** A permission that gets no answer in this time is denied. Default 10 minutes. */
  permissionTimeoutMs?: number;
  /** For tests: the stop timings of the process tree */
  stopTimings?: { graceMs?: number; killMs?: number };
}

export interface AgentState {
  running: boolean;
  pid?: number;
  liveSessions: number;
  lastExit?: { code: number | null; signal: NodeJS.Signals | null };
}

const DEFAULT_TIMEOUTS: AgentTimeouts = {
  initialize: 30_000,
  newSession: 30_000,
  loadSession: 120_000,
  configOption: 30_000,
  deleteSession: 30_000,
  listSessions: 30_000,
  closeSession: 30_000,
  cancelWait: 30_000,
};

function clientVersion(): string {
  try {
    const file = new URL('../../package.json', import.meta.url);
    const version = (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0';
  } catch {
    return '0';
  }
}

// --- internal state ---

interface Session {
  configOptions: ConfigOption[];
  /** True during session/new or session/load and the guard's first check */
  opening: boolean;
  /** Set while a guard check runs on this session: the session is not live */
  held?: Promise<void>;
}

/** One agent process and the sessions that are live on it */
interface Generation<TInfo> {
  proc: AgentChild;
  conn: AcpConnection;
  sessions: Map<string, Session>;
  info: Map<string, TInfo>;
  /** `agentCapabilities.sessionCapabilities` of the initialize result */
  sessionCapabilities?: Loose;
  /** The app stops this process; a close is then expected */
  stopRequested: boolean;
  stopping?: Promise<void>;
}

interface ActivePrompt<TInfo> {
  gen: Generation<TInfo>;
  onUpdate: (update: SessionUpdate) => void;
  onPermission?: PromptPermissionHandler;
  onPermissionEnd?: (end: PermissionEnd) => void;
  cancelled: boolean;
  cancelTimedOut: boolean;
  controller: AbortController;
  done: Promise<void>;
}

/** A session/load with replay that runs now */
interface Replay<TInfo> {
  /** The process that replays; cleared when the load's answer line is handled */
  gen: Generation<TInfo> | undefined;
  onUpdate: (update: SessionUpdate) => void;
  done: Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

export class AcpAgent<TInfo extends object> {
  protected readonly harness: AcpHarness<TInfo>;
  private readonly options: AcpAgentOptions;
  private readonly timeouts: AgentTimeouts;
  private readonly idleMs: number;
  private readonly permissionHandler: PermissionHandler;
  private readonly permissionTimeoutMs: number;

  private gen: Generation<TInfo> | undefined;
  private starting: Promise<Generation<TInfo>> | undefined;
  private readonly prompts = new Map<string, ActivePrompt<TInfo>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly replays = new Map<string, Replay<TInfo>>();
  private readonly notificationListeners = new Set<AgentNotificationListener>();
  /** Options that the user set, applied again after a session/load */
  private readonly desired = new Map<string, Map<string, string>>();
  private pendingRequests = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private lastExit: AgentState['lastExit'];
  /** stop() calls that run now: no new process starts meanwhile */
  private stopRuns = 0;
  /** Counts stop() calls: a retry that began before a stop() must not start a process */
  private stopCount = 0;
  /** Processes that are being stopped; stop() waits for them */
  private readonly stoppings = new Set<Promise<void>>();
  /** Set by close(): the agent never starts again */
  private closed = false;

  constructor(harness: AcpHarness<TInfo>, options: AcpAgentOptions = {}) {
    this.harness = harness;
    this.options = options;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.idleMs = options.idleMs ?? 600_000;
    this.permissionHandler = options.permissionHandler ?? denyPermission;
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? 600_000;
  }

  state(): AgentState {
    return {
      running: this.gen !== undefined,
      pid: this.gen?.proc.pid,
      liveSessions: this.gen?.sessions.size ?? 0,
      lastExit: this.lastExit,
    };
  }

  /** The latest config options of a session on the current process */
  configOptions(sessionId: string): ConfigOption[] | undefined {
    return this.gen?.sessions.get(sessionId)?.configOptions;
  }

  /** The harness's info of a live session; undefined when it is not live */
  sessionInfo(sessionId: string): TInfo | undefined {
    if (!this.isLive(sessionId)) return undefined;
    return { ...this.gen!.info.get(sessionId) } as TInfo;
  }

  /** How long the app waits for a reply to end after session/cancel */
  get cancelWaitMs(): number {
    return this.timeouts.cancelWait;
  }

  /** True while a prompt runs in this session, also while its cancel is ending */
  isBusy(sessionId: string): boolean {
    return this.prompts.has(sessionId);
  }

  /**
   * Resolves true when no prompt runs in this session (also after a cancel ends), false when one
   * still runs after `timeoutMs`.
   */
  async waitForIdle(sessionId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const active = this.prompts.get(sessionId);
      if (!active) return true;
      const left = deadline - Date.now();
      if (left <= 0) return false;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        active.done,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, left);
          timer.unref();
        }),
      ]);
      clearTimeout(timer);
    }
  }

  isLive(sessionId: string): boolean {
    const session = this.gen?.sessions.get(sessionId);
    return session !== undefined && !session.opening && session.held === undefined;
  }

  /**
   * A new session. `cwd` is the folder that the agent's tools work in: it must never come from
   * the browser. Default: the harness's workspace folder. The result has the folder that the
   * session uses, for the server only.
   */
  async newSession(input: { cwd?: string } = {}): Promise<{
    sessionId: string;
    configOptions: ConfigOption[];
    cwd: string;
  }> {
    const { agent, log } = this.harness.names;
    const cwd = input.cwd ?? (await this.harness.workspaceDir());
    const stops = this.stopCount;
    let gen = await this.start();
    let result: NewSessionResult;
    try {
      result = await this.call<NewSessionResult>(
        gen,
        'session/new',
        { cwd, mcpServers: [] },
        this.timeouts.newSession
      );
    } catch (error) {
      if (!(error instanceof AcpTimeoutError)) throw error;
      // A restart would end the replies and the sessions of other chats
      const busy =
        this.gen !== gen ||
        gen.sessions.size > 0 ||
        this.pendingRequests > 0 ||
        [...this.prompts.values()].some((p) => p.gen === gen);
      if (busy) {
        throw this.harness.createError('session', `${agent} is slow to open a chat. Try again.`);
      }
      console.warn(`[${log}] session/new timed out, starting a new process`);
      await this.stopGeneration(gen);
      if (this.stopCount !== stops) throw this.harness.createError('agent', `${agent} is stopping`);
      gen = await this.start();
      result = await this.call<NewSessionResult>(
        gen,
        'session/new',
        { cwd, mcpServers: [] },
        this.timeouts.newSession
      );
    }
    const sessionId = result.sessionId;
    void recordProcessGroups(gen.proc.child);
    gen.sessions.set(sessionId, { configOptions: result.configOptions ?? [], opening: true });
    await this.afterOpen(gen, sessionId, { created: true });
    return { sessionId, configOptions: gen.sessions.get(sessionId)?.configOptions ?? [], cwd };
  }

  /**
   * Makes the session live: a no-op when it is live, else session/load. Concurrent calls share
   * one load. `options` (from the saved conversation) replace the wanted option values; after a
   * load, the ones that the session lists are set again.
   *
   * `cwd` must never come from the browser: use the workspace folder or the session's own
   * folder.
   */
  async ensureSession(
    sessionId: string,
    cwd: string,
    input: { options?: Record<string, string> } = {}
  ): Promise<void> {
    if (input.options) {
      const wanted = new Map<string, string>();
      for (const [configId, value] of Object.entries(input.options)) {
        if (!this.harness.guard?.isLocked(configId) && typeof value === 'string') {
          wanted.set(configId, value);
        }
      }
      this.desired.set(sessionId, wanted);
    }
    // A replay of this session ends first: it closes the session at its end
    await this.replays.get(sessionId)?.done;
    const held = this.gen?.sessions.get(sessionId)?.held;
    if (held) await held;
    if (this.isLive(sessionId)) {
      // The idle timer must not end the process between ensureSession and prompt
      this.clearIdle();
      this.scheduleIdle();
      return;
    }
    const loading = this.loading.get(sessionId);
    if (loading) return loading;
    const promise = this.loadSession(sessionId, cwd).finally(() => this.loading.delete(sessionId));
    this.loading.set(sessionId, promise);
    return promise;
  }

  /**
   * Sets one option and reads it back. By default the value is also kept and set again when the
   * session is loaded again (a restarted process). `remember: false` leaves it to the agent:
   * the agent keeps its own values, and a change that the user made elsewhere must stay.
   */
  async setOption(
    sessionId: string,
    configId: string,
    value: string,
    { remember = true }: { remember?: boolean } = {}
  ): Promise<ConfigOption[]> {
    const { agent } = this.harness.names;
    if (this.harness.guard?.isLocked(configId)) {
      throw this.harness.createError('option', 'This option cannot be changed from the app');
    }
    // A change during a reply would apply to the rest of that reply
    if (this.prompts.has(sessionId)) {
      throw this.harness.createError('busy', `${agent} is still answering in this chat`);
    }
    const gen = this.liveGeneration(sessionId);
    const option = gen.sessions.get(sessionId)!.configOptions.find((o) => o.id === configId);
    if (!option) throw this.harness.createError('option', `${agent} has no option ${configId}`);
    if (!option.options?.some((o) => o.value === value)) {
      throw this.harness.createError('option', `${agent} option ${configId} has no value ${value}`);
    }
    const options = await this.setConfig(gen, sessionId, configId, value);
    const after = options.find((o) => o.id === configId)?.currentValue;
    if (after !== value) {
      throw this.harness.createError('option', `${agent} did not change ${configId} to ${value}`);
    }
    if (remember) {
      let wanted = this.desired.get(sessionId);
      if (!wanted) this.desired.set(sessionId, (wanted = new Map()));
      wanted.set(configId, value);
    }
    return options;
  }

  /** Calls an extension method from the harness's extensionMethods */
  async extension<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.harness.extensionMethods.includes(method)) {
      throw this.harness.createError('agent', `The app does not call ${method}`);
    }
    const gen = await this.start();
    return this.call<T>(gen, method, params, timeoutMs ?? this.timeouts.configOption);
  }

  async prompt(
    sessionId: string,
    blocks: ContentBlock[],
    input: {
      onUpdate: (update: SessionUpdate) => void;
      signal?: AbortSignal;
      /** Answers this prompt's permission requests. Default: the agent's permissionHandler. */
      onPermission?: PromptPermissionHandler;
      /** Called once when a question that `onPermission` got ends (answer, cancel, timeout) */
      onPermissionEnd?: (end: PermissionEnd) => void;
    }
  ): Promise<StopReason> {
    const { agent } = this.harness.names;
    if (this.prompts.has(sessionId)) {
      throw this.harness.createError('busy', `${agent} is still answering in this chat`);
    }
    const gen = this.liveGeneration(sessionId);
    if (input.signal?.aborted) return 'cancelled';

    let finish!: () => void;
    const active: ActivePrompt<TInfo> = {
      gen,
      onUpdate: input.onUpdate,
      onPermission: input.onPermission,
      onPermissionEnd: input.onPermissionEnd,
      cancelled: false,
      cancelTimedOut: false,
      controller: new AbortController(),
      done: new Promise<void>((resolve) => (finish = resolve)),
    };
    this.prompts.set(sessionId, active);
    this.clearIdle();
    void recordProcessGroups(gen.proc.child);
    const onAbort = () => void this.cancel(sessionId).catch(() => undefined);
    input.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await gen.conn.request<PromptResult>('session/prompt', {
        sessionId,
        prompt: blocks,
      });
      return result.stopReason;
    } catch (error) {
      if (active.cancelTimedOut) {
        throw this.harness.createError(
          'cancel-timeout',
          `${agent} did not stop in time, so the app stopped it`
        );
      }
      throw this.mapError(error);
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
      active.controller.abort();
      if (this.prompts.get(sessionId) === active) this.prompts.delete(sessionId);
      finish();
      this.scheduleIdle();
    }
  }

  /** session/cancel, then wait for the reply to end. When it does not end, stop the process. */
  async cancel(sessionId: string): Promise<void> {
    const active = this.prompts.get(sessionId);
    if (!active) return;
    if (!active.cancelled) {
      active.cancelled = true;
      active.controller.abort();
      active.gen.conn.notify('session/cancel', { sessionId });
    }
    const ended = await Promise.race([
      active.done.then(() => true),
      sleep(this.timeouts.cancelWait).then(() => false),
    ]);
    if (ended) return;
    console.warn(
      `[${this.harness.names.log}] a reply did not stop after session/cancel, stopping the process`
    );
    active.cancelTimedOut = true;
    await this.stopGeneration(active.gen);
  }

  /**
   * session/list: the agent's sessions, as it returns them. Throws the 'session' error when the
   * agent does not list sessions.
   */
  async listSessions(params: ListSessionsParams = {}): Promise<ListSessionsResult> {
    const gen = await this.start();
    if (!gen.sessionCapabilities?.list) {
      throw this.harness.createError('session', `${this.harness.names.cli} cannot list sessions`);
    }
    const result = await this.call<ListSessionsResult | null>(
      gen,
      'session/list',
      params,
      this.timeouts.listSessions
    );
    return { ...result, sessions: Array.isArray(result?.sessions) ? result.sessions : [] };
  }

  /**
   * Reads a session without opening it for prompts: session/load with no `_meta`, so the agent
   * replays the session as session/update notifications before it answers. Each update goes to
   * `onUpdate` as it comes (not kept). The replay ends when the answer line is handled, so
   * an update after the answer never reaches it, also in the same read. Then session/close.
   * The session is not live afterwards.
   *
   * `cwd` must come from the agent's own session list, never from the browser. Throws the
   * 'busy' error while a prompt, a load, or another replay runs in the session.
   */
  async replaySession(
    sessionId: string,
    cwd: string,
    onUpdate: (update: SessionUpdate) => void
  ): Promise<LoadSessionResult> {
    if (this.prompts.has(sessionId) || this.loading.has(sessionId) || this.replays.has(sessionId)) {
      throw this.harness.createError(
        'busy',
        `${this.harness.names.agent} is still answering in this chat`
      );
    }
    let finish!: () => void;
    const replay: Replay<TInfo> = {
      gen: undefined,
      onUpdate,
      done: new Promise<void>((resolve) => (finish = resolve)),
    };
    this.replays.set(sessionId, replay);
    try {
      // Open on this process for prompts: close it first, so that the load replays it
      if (this.gen?.sessions.has(sessionId)) await this.closeSession(sessionId);
      const gen = await this.start();
      replay.gen = gen;
      const params: LoadSessionParams = { sessionId, cwd, mcpServers: [] };
      let result: LoadSessionResult | null;
      try {
        result = await this.call<LoadSessionResult | null>(
          gen,
          'session/load',
          params,
          this.timeouts.loadSession,
          // When the answer line is handled: a later line of the same read is not replay
          () => (replay.gen = undefined)
        );
      } finally {
        replay.gen = undefined;
        if (!gen.sessions.has(sessionId)) gen.info.delete(sessionId);
      }
      // Only the session that this call loaded
      if (gen.sessionCapabilities?.close) {
        try {
          await this.call(gen, 'session/close', { sessionId }, this.timeouts.closeSession);
        } catch (error) {
          console.warn(
            `[${this.harness.names.log}] could not close a replayed session: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }
      return result ?? {};
    } finally {
      this.replays.delete(sessionId);
      finish();
    }
  }

  /**
   * session/close of a session that is open on the current process: the agent keeps its files
   * and lets other programs use it. The session is then not live; the next ensureSession loads
   * it again with the same wanted options. A no-op when the agent cannot close sessions or the
   * session is not open here. Throws the 'busy' error while a prompt runs in it.
   */
  async closeSession(sessionId: string): Promise<void> {
    if (this.prompts.has(sessionId)) {
      throw this.harness.createError(
        'busy',
        `${this.harness.names.agent} is still answering in this chat`
      );
    }
    const gen = this.gen;
    if (!gen?.sessionCapabilities?.close || !gen.sessions.has(sessionId)) return;
    if (this.loading.has(sessionId)) return;
    // Not live from now on: a load that starts meanwhile is sent after the close
    gen.sessions.delete(sessionId);
    gen.info.delete(sessionId);
    const params: CloseSessionParams = { sessionId };
    await this.call(gen, 'session/close', params, this.timeouts.closeSession);
  }

  /** Listens to the agent's notifications other than session/update. Returns the unsubscribe. */
  onAgentNotification(listener: AgentNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => void this.notificationListeners.delete(listener);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.prompts.has(sessionId)) {
      throw this.harness.createError(
        'busy',
        `${this.harness.names.agent} is still answering in this chat`
      );
    }
    const gen = this.gen?.sessions.has(sessionId) ? this.gen : await this.start();
    await this.call(gen, 'session/delete', { sessionId }, this.timeouts.deleteSession);
    gen.sessions.delete(sessionId);
    gen.info.delete(sessionId);
    this.desired.delete(sessionId);
  }

  /**
   * Stops the process and all its process groups. Safe to call more than once. No new process
   * starts while it runs: such calls reject with the 'agent' error "<agent> is stopping".
   */
  async stop(): Promise<void> {
    this.stopRuns += 1;
    this.stopCount += 1;
    try {
      this.clearIdle();
      while (this.starting || this.gen || this.stoppings.size) {
        if (this.starting) await this.starting.catch(() => undefined);
        if (this.gen) await this.stopGeneration(this.gen);
        if (this.stoppings.size) await Promise.all(this.stoppings);
      }
    } finally {
      this.stopRuns -= 1;
    }
  }

  /** stop(), and the agent never starts again */
  close(): Promise<void> {
    this.closed = true;
    return this.stop();
  }

  // --- process ---

  private start(): Promise<Generation<TInfo>> {
    if (this.closed || this.stopRuns > 0) {
      return Promise.reject(
        this.harness.createError('agent', `${this.harness.names.agent} is stopping`)
      );
    }
    if (this.gen) return Promise.resolve(this.gen);
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async launch(): Promise<Generation<TInfo>> {
    const { agent, cli, log } = this.harness.names;
    const launch = await this.harness.launch();

    const proc = spawnAgentProcess(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
    });
    const conn = AcpConnection.fromChild(proc.child, { name: agent, logTag: log });
    const gen: Generation<TInfo> = {
      proc,
      conn,
      sessions: new Map(),
      info: new Map(),
      stopRequested: false,
    };
    proc.child.once('error', (error) => conn.close(error.message));
    void proc.exited.then((exit) => {
      this.lastExit = exit;
      console.log(`[${log}] agent exited code ${exit.code ?? exit.signal ?? 'unknown'}`);
    });
    conn.onClose(() => {
      // Every prompt on it is rejected by the connection
      if (this.gen === gen) this.gen = undefined;
      if (!gen.stopRequested) {
        // A crash: its children are reparented now, so stop the groups recorded while it ran
        console.warn(`[${log}] agent closed unexpectedly`);
        void this.stopGeneration(gen, { graceMs: 0 });
      }
      this.scheduleIdle();
    });
    conn.onNotification((method, params) => this.onNotification(gen, method, params));
    conn.onRequest((method, params) => {
      if (method !== 'session/request_permission') return undefined;
      return this.onPermission(gen, params as PermissionRequest);
    });

    // The app implements no fs or terminal methods: the agent must not count on them
    const init: InitializeParams = {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'local-llm-ui', version: clientVersion() },
    };
    let result: InitializeResult | null;
    try {
      this.pendingRequests += 1;
      result = await conn.request<InitializeResult | null>('initialize', init, {
        timeoutMs: this.timeouts.initialize,
      });
    } catch (error) {
      await this.stopGeneration(gen);
      throw this.mapError(error);
    } finally {
      this.pendingRequests -= 1;
    }
    await recordProcessGroups(proc.child);
    let signedOut: boolean;
    try {
      signedOut = this.harness.signedOut(result);
    } catch (error) {
      await this.stopGeneration(gen);
      throw error;
    }
    if (signedOut) {
      await this.stopGeneration(gen);
      throw this.harness.createError('signed-out', `${cli} is not signed in`);
    }
    if (result?.agentCapabilities?.loadSession !== true) {
      await this.stopGeneration(gen);
      throw this.harness.createError('session', `This ${cli} cannot load sessions`);
    }
    if (conn.closed) throw this.harness.createError('crashed', `${cli} stopped while it started`);
    gen.sessionCapabilities = result.agentCapabilities.sessionCapabilities;
    console.log(`[${log}] agent started pid ${proc.pid}`);
    this.gen = gen;
    this.scheduleIdle();
    return gen;
  }

  private stopGeneration(
    gen: Generation<TInfo>,
    timings: { graceMs?: number } = {}
  ): Promise<void> {
    if (!gen.stopping) {
      gen.stopRequested = true;
      if (this.gen === gen) this.gen = undefined;
      gen.conn.close('stopped');
      gen.stopping = stopProcessTree(gen.proc.child, {
        ...this.options.stopTimings,
        ...timings,
      }).then(() => console.log(`[${this.harness.names.log}] agent stopped pid ${gen.proc.pid}`));
      const stopping = gen.stopping;
      this.stoppings.add(stopping);
      void stopping.finally(() => this.stoppings.delete(stopping));
    }
    return gen.stopping;
  }

  // --- requests ---

  private liveGeneration(sessionId: string): Generation<TInfo> {
    if (!this.isLive(sessionId)) {
      throw this.harness.createError(
        'session',
        `The ${this.harness.names.agent} session is not open. Call ensureSession first.`
      );
    }
    return this.gen!;
  }

  private async loadSession(sessionId: string, cwd: string): Promise<void> {
    const gen = await this.start();
    const result = await this.call<LoadSessionResult>(
      gen,
      'session/load',
      { sessionId, cwd, mcpServers: [], _meta: this.harness.loadMeta },
      this.timeouts.loadSession
    );
    void recordProcessGroups(gen.proc.child);
    gen.sessions.set(sessionId, { configOptions: result?.configOptions ?? [], opening: true });
    if (result) this.harness.sessionInfo.fromLoad(result, this.infoFor(gen, sessionId));
    await this.afterOpen(gen, sessionId, { created: false });
    // The same option settings again
    for (const [configId, value] of this.desired.get(sessionId) ?? []) {
      const option = gen.sessions.get(sessionId)?.configOptions.find((o) => o.id === configId);
      if (!option || option.currentValue === value) continue;
      if (!option.options?.some((o) => o.value === value)) continue;
      await this.setConfig(gen, sessionId, configId, value);
    }
  }

  private async call<T>(
    gen: Generation<TInfo>,
    method: string,
    params: unknown,
    timeoutMs: number,
    onSettled?: () => void
  ): Promise<T> {
    this.pendingRequests += 1;
    this.clearIdle();
    try {
      return await gen.conn.request<T>(method, params, { timeoutMs, onSettled });
    } catch (error) {
      throw this.mapError(error);
    } finally {
      this.pendingRequests -= 1;
      this.scheduleIdle();
    }
  }

  private mapError(error: unknown): unknown {
    const { cli } = this.harness.names;
    if (error instanceof AcpClosedError)
      return this.harness.createError('crashed', `${cli} stopped`);
    if (error instanceof AcpError && this.harness.isSignedOutError(error)) {
      return this.harness.createError('signed-out', `${cli} is not signed in`);
    }
    return error;
  }

  /** session/set_config_option without the guard */
  private async setConfigRaw(
    gen: Generation<TInfo>,
    sessionId: string,
    configId: string,
    value: string
  ): Promise<SetConfigOptionResult> {
    return this.call<SetConfigOptionResult>(
      gen,
      'session/set_config_option',
      { sessionId, configId, value },
      this.timeouts.configOption
    );
  }

  /** set_config_option. The guard checks the result like every config change. */
  private async setConfig(
    gen: Generation<TInfo>,
    sessionId: string,
    configId: string,
    value: string
  ): Promise<ConfigOption[]> {
    const result = await this.setConfigRaw(gen, sessionId, configId, value);
    const options = result?.configOptions ?? [];
    const session = gen.sessions.get(sessionId);
    if (session && options.length) session.configOptions = options;
    const check = this.runCheck(gen, sessionId, options);
    if (check) {
      await check;
      if (gen.sessions.get(sessionId)?.held !== undefined || !gen.sessions.has(sessionId)) {
        throw this.harness.guard!.refused();
      }
      return gen.sessions.get(sessionId)!.configOptions;
    }
    return options;
  }

  private guardContext(gen: Generation<TInfo>, sessionId: string, session: Session): GuardContext {
    return {
      sessionId,
      configOptions: () => session.configOptions,
      setConfig: async (configId, value) => {
        const result = await this.setConfigRaw(gen, sessionId, configId, value);
        if (result?.configOptions?.length) session.configOptions = result.configOptions;
        return session.configOptions;
      },
      cancelReply: () => {
        const active = this.prompts.get(sessionId);
        if (active?.gen === gen) void this.cancel(sessionId).catch(() => undefined);
      },
      drop: () => this.dropSession(gen, sessionId, session),
      deleteSession: async () => {
        await this.call(gen, 'session/delete', { sessionId }, this.timeouts.deleteSession);
      },
      isCurrent: () => gen.sessions.get(sessionId) === session,
    };
  }

  /**
   * The guard's first decision on a session that was just opened, then a check of its options
   * (a config_option_update during the open may have changed them).
   */
  private async afterOpen(
    gen: Generation<TInfo>,
    sessionId: string,
    { created }: { created: boolean }
  ): Promise<void> {
    const session = gen.sessions.get(sessionId)!;
    const guard = this.harness.guard;
    try {
      if (guard) await guard.afterOpen(this.guardContext(gen, sessionId, session), created);
    } finally {
      session.opening = false;
    }
    const check = this.runCheck(gen, sessionId, session.configOptions);
    if (check) {
      await check;
      if (!this.isLive(sessionId)) throw guard!.refused();
    }
  }

  /**
   * Runs the guard's check on every set_config_option result and every config_option_update.
   * While the check runs, the session is held (not live). One check at a time per session, and
   * none while the session opens or the process stops.
   */
  private runCheck(
    gen: Generation<TInfo>,
    sessionId: string,
    options: ConfigOption[]
  ): Promise<void> | undefined {
    const guard = this.harness.guard;
    if (!guard) return undefined;
    const session = gen.sessions.get(sessionId);
    if (!session || session.opening || gen.stopRequested) return undefined;
    if (session.held) return session.held;
    const ctx = this.guardContext(gen, sessionId, session);
    const pending = guard.check(ctx, options);
    if (!pending) return undefined;
    const held: Promise<void> = pending
      .catch(() => {
        console.warn(
          `[${this.harness.names.log}] session guard check failed, dropping the session`
        );
        ctx.drop();
      })
      .finally(() => {
        if (session.held === held) session.held = undefined;
      });
    session.held = held;
    return held;
  }

  private dropSession(gen: Generation<TInfo>, sessionId: string, session: Session): void {
    if (gen.sessions.get(sessionId) !== session) return;
    gen.sessions.delete(sessionId);
    gen.info.delete(sessionId);
  }

  private infoFor(gen: Generation<TInfo>, sessionId: string): TInfo {
    let info = gen.info.get(sessionId);
    if (!info) gen.info.set(sessionId, (info = {} as TInfo));
    return info;
  }

  // --- from the agent ---

  private onNotification(gen: Generation<TInfo>, method: string, params: unknown): void {
    if (method !== 'session/update') {
      for (const listener of this.notificationListeners) {
        try {
          listener(method, params);
        } catch (error) {
          console.warn(
            `[${this.harness.names.log}] notification listener failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }
      return;
    }
    const { sessionId, update } = (params ?? {}) as Partial<SessionNotification>;
    if (typeof sessionId !== 'string' || !update || typeof update.sessionUpdate !== 'string')
      return;
    const replay = this.replays.get(sessionId);
    if (replay && replay.gen === gen) {
      replay.onUpdate(update);
      return;
    }
    if (update.sessionUpdate === 'config_option_update') {
      const session = gen.sessions.get(sessionId);
      const options = (update as { configOptions?: unknown }).configOptions;
      if (session && Array.isArray(options)) {
        session.configOptions = options as ConfigOption[];
        void this.runCheck(gen, sessionId, session.configOptions);
      }
    } else if (update.sessionUpdate === 'session_info_update') {
      this.harness.sessionInfo.fromUpdate(update, this.infoFor(gen, sessionId));
    }
    const active = this.prompts.get(sessionId);
    if (active && active.gen === gen) active.onUpdate(update);
  }

  private async onPermission(
    gen: Generation<TInfo>,
    request: PermissionRequest
  ): Promise<PermissionOutcome> {
    const options = Array.isArray(request?.options) ? request.options : [];
    const active = this.prompts.get(request?.sessionId);
    if (!active || active.gen !== gen || active.cancelled) {
      return { outcome: { outcome: 'cancelled' } };
    }
    const promptSignal = active.controller.signal;
    // One signal per question: it aborts when the prompt ends and when this question ends
    const question = new AbortController();
    const onPromptEnd = () => question.abort();
    promptSignal.addEventListener('abort', onPromptEnd, { once: true });
    const signal = question.signal;
    const requestId = randomUUID();
    const toolCallId = String(request.toolCall?.toolCallId ?? '');
    const onPermission = active.onPermission;
    const ask = async (): Promise<PermissionDecision> => {
      if (onPermission) {
        return onPermission({
          requestId,
          toolCallId,
          title: typeof request.toolCall?.title === 'string' ? request.toolCall.title : undefined,
          options,
          meta: request._meta,
          signal,
        });
      }
      return this.permissionHandler({
        sessionId: request.sessionId,
        request: { ...request, options },
        signal,
      });
    };
    let answer: Awaited<ReturnType<typeof answerPermission>>;
    try {
      answer = await answerPermission({
        options,
        signal,
        timeoutMs: this.permissionTimeoutMs,
        cancelled: () => active.cancelled,
        ask,
      });
    } finally {
      promptSignal.removeEventListener('abort', onPromptEnd);
      question.abort();
    }
    if (onPermission && active.onPermissionEnd) {
      const selected = answer.outcome.outcome;
      const optionId = selected.outcome === 'selected' ? selected.optionId : undefined;
      const kind = options.find((o) => o.optionId === optionId)?.kind;
      try {
        active.onPermissionEnd({
          requestId,
          toolCallId,
          end: answer.end,
          ...(optionId !== undefined && { optionId }),
          ...(kind !== undefined && { kind }),
        });
      } catch {
        // The chat's callback must not change the agent's answer
      }
    }
    return answer.outcome;
  }

  // --- idle ---

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdle(): void {
    this.clearIdle();
    const gen = this.gen;
    if (!gen || this.pendingRequests > 0 || this.prompts.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.gen !== gen || this.pendingRequests > 0 || this.prompts.size > 0) return;
      console.log(`[${this.harness.names.log}] agent idle`);
      void this.stopGeneration(gen);
    }, this.idleMs);
    this.idleTimer.unref();
  }
}
