/**
 * The shared Kiro process (D5): one `kiro-cli acp` for all Kiro chats.
 *
 * It starts on the first use and stops after 10 idle minutes. One process holds many sessions.
 * After a crash, a stop, or an idle stop, a session is not live: `ensureSession` opens it again
 * with `session/load`. Every session gets Autopilot off (D7), read back from Kiro.
 *
 * Logs lifecycle lines only. Never log prompt text, tool input, or the account.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { chmod, mkdir, stat } from 'fs/promises';
import path from 'path';

import { AcpClosedError, AcpConnection, AcpError, AcpTimeoutError } from '../acp/client.ts';
import type {
  ConfigOption,
  ContentBlock,
  InitializeParams,
  InitializeResult,
  LoadSessionResult,
  NewSessionResult,
  PermissionOption,
  PermissionOptionKind,
  PermissionOutcome,
  PermissionRequest,
  PromptResult,
  SessionNotification,
  SessionUpdate,
  SetConfigOptionResult,
  StopReason,
} from '../acp/types.ts';
import { defaultKiroEnvironment, resolveKiroBinary } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import { recordProcessGroups, spawnKiroAcp, stopProcessTree } from '../acp/process.ts';
import type { KiroChild } from '../acp/process.ts';

export { AcpError, AcpTimeoutError } from '../acp/client.ts';

// --- errors ---

export class KiroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class KiroNotInstalledError extends KiroError {}
export class KiroSignedOutError extends KiroError {}
export class KiroSessionError extends KiroError {}
export class KiroOptionError extends KiroError {}
export class KiroBusyError extends KiroError {}
export class KiroCrashedError extends KiroError {}
export class KiroCancelTimeoutError extends KiroError {}

// --- options ---

export type PermissionDecision = { optionId: string } | 'cancelled';

/** The agent-wide handler. Default: deny. */
export type PermissionHandler = (input: {
  sessionId: string;
  request: PermissionRequest;
  /** Aborts when the prompt is cancelled or ends */
  signal: AbortSignal;
}) => Promise<PermissionDecision> | PermissionDecision;

/** One permission request of one prompt, for the chat that asked (K6) */
export interface PermissionQuestion {
  /** A random id for this request, for the answer from the browser */
  requestId: string;
  toolCallId: string;
  title?: string;
  options: PermissionOption[];
  /** Aborts when the prompt is cancelled or ends */
  signal: AbortSignal;
}

export type PromptPermissionHandler = (
  question: PermissionQuestion
) => Promise<PermissionDecision> | PermissionDecision;

export interface KiroAgentTimeouts {
  initialize: number;
  newSession: number;
  loadSession: number;
  configOption: number;
  deleteSession: number;
  cancelWait: number;
}

/** What the app knows of a live session, also from updates outside a prompt */
export interface KiroSessionInfo {
  /** Percent of the context window, from context_usage or the session/load result */
  contextPercent?: number;
  /** From focus_update */
  title?: string;
  /** The session's credits as Kiro reports them in session_usage */
  credits?: number;
}

/** The Kiro extension methods that `extension()` may call */
export const KIRO_EXTENSION_METHODS: readonly string[] = ['_kiro/account/getUsage'];

/** Options that the app never changes: Autopilot stays off (D7), the agent stays Kiro's default (D9) */
const LOCKED_OPTIONS = new Set(['autopilot', 'mode']);

export interface KiroAgentOptions {
  environment?: KiroEnvironment;
  resolveBinary?: typeof resolveKiroBinary;
  workspaceDir?: string;
  idleMs?: number;
  timeouts?: Partial<KiroAgentTimeouts>;
  /** Default: deny (D7: no tool runs without a question until approvals land) */
  permissionHandler?: PermissionHandler;
  /** A permission that gets no answer in this time is denied. Default 10 minutes. */
  permissionTimeoutMs?: number;
  /** For tests: the stop timings of the process tree */
  stopTimings?: { graceMs?: number; killMs?: number };
}

export interface KiroAgentState {
  running: boolean;
  pid?: number;
  liveSessions: number;
  lastExit?: { code: number | null; signal: NodeJS.Signals | null };
}

const DEFAULT_TIMEOUTS: KiroAgentTimeouts = {
  initialize: 30_000,
  newSession: 30_000,
  loadSession: 120_000,
  configOption: 30_000,
  deleteSession: 30_000,
  cancelWait: 30_000,
};

/** The option of this kind, by kind and never by id */
export function optionIdForKind(
  request: PermissionRequest,
  kind: PermissionOptionKind
): string | undefined {
  return request.options.find((o) => o.kind === kind)?.optionId;
}

export const denyPermission: PermissionHandler = ({ request }) => {
  const optionId = optionIdForKind(request, 'reject_once');
  return optionId ? { optionId } : 'cancelled';
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
  /** True during session/new or session/load and the first Autopilot check */
  opening: boolean;
  /** Set while Autopilot was reported on and is being turned off again: the session is not live */
  unsafe?: Promise<void>;
}

/** One `kiro-cli acp` process and the sessions that are live on it */
interface Generation {
  proc: KiroChild;
  conn: AcpConnection;
  sessions: Map<string, Session>;
  info: Map<string, KiroSessionInfo>;
  /** The app stops this process; a close is then expected */
  stopRequested: boolean;
  stopping?: Promise<void>;
}

interface ActivePrompt {
  gen: Generation;
  onUpdate: (update: SessionUpdate) => void;
  onPermission?: PromptPermissionHandler;
  cancelled: boolean;
  cancelTimedOut: boolean;
  controller: AbortController;
  done: Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

const autopilotOf = (options: ConfigOption[]) =>
  options.find((o) => o.id === 'autopilot')?.currentValue;

const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export class KiroAgent {
  private readonly options: KiroAgentOptions;
  private readonly timeouts: KiroAgentTimeouts;
  private readonly idleMs: number;
  private readonly permissionHandler: PermissionHandler;
  private readonly permissionTimeoutMs: number;

  private gen: Generation | undefined;
  private starting: Promise<Generation> | undefined;
  private workspaceReady: Promise<string> | undefined;
  private readonly prompts = new Map<string, ActivePrompt>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Options that the user set, applied again after a session/load */
  private readonly desired = new Map<string, Map<string, string>>();
  private pendingRequests = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private lastExit: KiroAgentState['lastExit'];
  /** stop() calls that run now: no new process starts meanwhile */
  private stopRuns = 0;
  /** Counts stop() calls: a retry that began before a stop() must not start a process */
  private stopCount = 0;
  /** Processes that are being stopped; stop() waits for them */
  private readonly stoppings = new Set<Promise<void>>();
  /** Set by close(): the agent never starts again */
  private closed = false;

  constructor(options: KiroAgentOptions = {}) {
    this.options = options;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.idleMs = options.idleMs ?? 600_000;
    this.permissionHandler = options.permissionHandler ?? denyPermission;
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? 600_000;
  }

  state(): KiroAgentState {
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

  /** Context, title, and credits of a live session; undefined when it is not live */
  sessionInfo(sessionId: string): KiroSessionInfo | undefined {
    if (!this.isLive(sessionId)) return undefined;
    return { ...this.gen!.info.get(sessionId) };
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
    return session !== undefined && !session.opening && session.unsafe === undefined;
  }

  /**
   * A new session. `cwd` is the folder that Kiro's tools work in: it must never come from the
   * browser. Default: the app's Kiro workspace folder.
   */
  async newSession(input: { cwd?: string } = {}): Promise<{
    sessionId: string;
    configOptions: ConfigOption[];
  }> {
    const cwd = input.cwd ?? (await this.workspaceDir());
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
      if (busy) throw new KiroSessionError('Kiro is slow to open a chat. Try again.');
      console.warn('[kiro] session/new timed out, starting a new process');
      await this.stopGeneration(gen);
      if (this.stopCount !== stops) throw new KiroError('Kiro is stopping');
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
    return { sessionId, configOptions: gen.sessions.get(sessionId)?.configOptions ?? [] };
  }

  /**
   * Makes the session live: a no-op when it is live, else session/load. Concurrent calls share
   * one load. `options` (from the saved conversation) replace the wanted option values; after a
   * load, the ones that the session lists are set again.
   *
   * `cwd` must never come from the browser: use the workspace folder or the session's own
   * `workspacePaths`.
   */
  async ensureSession(
    sessionId: string,
    cwd: string,
    input: { options?: Record<string, string> } = {}
  ): Promise<void> {
    if (input.options) {
      const wanted = new Map<string, string>();
      for (const [configId, value] of Object.entries(input.options)) {
        if (!LOCKED_OPTIONS.has(configId) && typeof value === 'string') wanted.set(configId, value);
      }
      this.desired.set(sessionId, wanted);
    }
    const unsafe = this.gen?.sessions.get(sessionId)?.unsafe;
    if (unsafe) await unsafe;
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

  async setOption(sessionId: string, configId: string, value: string): Promise<ConfigOption[]> {
    if (LOCKED_OPTIONS.has(configId)) {
      throw new KiroOptionError('This option cannot be changed from the app');
    }
    // A change during a reply would apply to the rest of that reply
    if (this.prompts.has(sessionId))
      throw new KiroBusyError('Kiro is still answering in this chat');
    const gen = this.liveGeneration(sessionId);
    const option = gen.sessions.get(sessionId)!.configOptions.find((o) => o.id === configId);
    if (!option) throw new KiroOptionError(`Kiro has no option ${configId}`);
    if (!option.options?.some((o) => o.value === value)) {
      throw new KiroOptionError(`Kiro option ${configId} has no value ${value}`);
    }
    const options = await this.setConfig(gen, sessionId, configId, value);
    const after = options.find((o) => o.id === configId)?.currentValue;
    if (after !== value) throw new KiroOptionError(`Kiro did not change ${configId} to ${value}`);
    let wanted = this.desired.get(sessionId);
    if (!wanted) this.desired.set(sessionId, (wanted = new Map()));
    wanted.set(configId, value);
    return options;
  }

  /** Calls a Kiro extension method from KIRO_EXTENSION_METHODS */
  async extension<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!KIRO_EXTENSION_METHODS.includes(method)) {
      throw new KiroError(`The app does not call ${method}`);
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
    }
  ): Promise<StopReason> {
    if (this.prompts.has(sessionId))
      throw new KiroBusyError('Kiro is still answering in this chat');
    const gen = this.liveGeneration(sessionId);
    if (input.signal?.aborted) return 'cancelled';

    let finish!: () => void;
    const active: ActivePrompt = {
      gen,
      onUpdate: input.onUpdate,
      onPermission: input.onPermission,
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
        throw new KiroCancelTimeoutError('Kiro did not stop in time, so the app stopped it');
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
    console.warn('[kiro] a reply did not stop after session/cancel, stopping the process');
    active.cancelTimedOut = true;
    await this.stopGeneration(active.gen);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.prompts.has(sessionId)) {
      throw new KiroBusyError('Kiro is still answering in this chat');
    }
    const gen = this.gen?.sessions.has(sessionId) ? this.gen : await this.start();
    await this.call(gen, 'session/delete', { sessionId }, this.timeouts.deleteSession);
    gen.sessions.delete(sessionId);
    gen.info.delete(sessionId);
    this.desired.delete(sessionId);
  }

  /**
   * Stops the process and all its process groups. Safe to call more than once. No new process
   * starts while it runs: such calls reject with KiroError('Kiro is stopping').
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

  private workspaceDir(): Promise<string> {
    if (!this.workspaceReady) {
      const environment = this.options.environment ?? defaultKiroEnvironment();
      const dir = this.options.workspaceDir ?? path.join(environment.home, '.local-llm-ui', 'kiro');
      this.workspaceReady = (async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const uid = process.getuid?.();
        if (uid !== undefined && (await stat(dir)).uid !== uid) {
          // The path goes to the terminal only, never to the browser
          console.warn(`[kiro] the Kiro folder ${dir} belongs to another user`);
          throw new KiroError('The Kiro folder of the app belongs to another user');
        }
        // mkdir sets the mode only on a folder that it creates
        await chmod(dir, 0o700);
        return dir;
      })().catch((error: unknown) => {
        this.workspaceReady = undefined;
        throw error;
      });
    }
    return this.workspaceReady;
  }

  private start(): Promise<Generation> {
    if (this.closed || this.stopRuns > 0) return Promise.reject(new KiroError('Kiro is stopping'));
    if (this.gen) return Promise.resolve(this.gen);
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async launch(): Promise<Generation> {
    const environment = this.options.environment ?? defaultKiroEnvironment();
    const binary = await (this.options.resolveBinary ?? resolveKiroBinary)(environment);
    if (!binary) throw new KiroNotInstalledError('Kiro CLI is not installed');
    if ('error' in binary) throw new KiroNotInstalledError(binary.error);
    const cwd = await this.workspaceDir();

    const proc = spawnKiroAcp(binary.path, { cwd, env: environment.env });
    const conn = AcpConnection.fromChild(proc.child);
    const gen: Generation = {
      proc,
      conn,
      sessions: new Map(),
      info: new Map(),
      stopRequested: false,
    };
    proc.child.once('error', (error) => conn.close(error.message));
    void proc.exited.then((exit) => {
      this.lastExit = exit;
      console.log(`[kiro] agent exited code ${exit.code ?? exit.signal ?? 'unknown'}`);
    });
    conn.onClose(() => {
      // Every prompt on it is rejected by the connection
      if (this.gen === gen) this.gen = undefined;
      if (!gen.stopRequested) {
        // A crash: its children are reparented now, so stop the groups recorded while it ran
        console.warn('[kiro] agent closed unexpectedly');
        void this.stopGeneration(gen, { graceMs: 0 });
      }
      this.scheduleIdle();
    });
    conn.onNotification((method, params) => this.onNotification(gen, method, params));
    conn.onRequest((method, params) => {
      if (method !== 'session/request_permission') return undefined;
      return this.onPermission(gen, params as PermissionRequest);
    });

    const init: InitializeParams = {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'local-llm-ui', version: clientVersion() },
    };
    let result: InitializeResult;
    try {
      this.pendingRequests += 1;
      result = await conn.request<InitializeResult>('initialize', init, {
        timeoutMs: this.timeouts.initialize,
      });
    } catch (error) {
      await this.stopGeneration(gen);
      throw this.mapError(error);
    } finally {
      this.pendingRequests -= 1;
    }
    await recordProcessGroups(proc.child);
    if (result?.authMethods?.some((m) => m.id === 'kiro-login') === true) {
      await this.stopGeneration(gen);
      throw new KiroSignedOutError('Kiro CLI is not signed in');
    }
    if (result?.agentCapabilities?.loadSession !== true) {
      await this.stopGeneration(gen);
      throw new KiroSessionError('This Kiro CLI cannot load sessions');
    }
    if (conn.closed) throw new KiroCrashedError('Kiro CLI stopped while it started');
    console.log(`[kiro] agent started pid ${proc.pid}`);
    this.gen = gen;
    this.scheduleIdle();
    return gen;
  }

  private stopGeneration(gen: Generation, timings: { graceMs?: number } = {}): Promise<void> {
    if (!gen.stopping) {
      gen.stopRequested = true;
      if (this.gen === gen) this.gen = undefined;
      gen.conn.close('stopped');
      gen.stopping = stopProcessTree(gen.proc.child, {
        ...this.options.stopTimings,
        ...timings,
      }).then(() => console.log(`[kiro] agent stopped pid ${gen.proc.pid}`));
      const stopping = gen.stopping;
      this.stoppings.add(stopping);
      void stopping.finally(() => this.stoppings.delete(stopping));
    }
    return gen.stopping;
  }

  // --- requests ---

  private liveGeneration(sessionId: string): Generation {
    if (!this.isLive(sessionId)) {
      throw new KiroSessionError('The Kiro session is not open. Call ensureSession first.');
    }
    return this.gen!;
  }

  private async loadSession(sessionId: string, cwd: string): Promise<void> {
    const gen = await this.start();
    const result = await this.call<LoadSessionResult>(
      gen,
      'session/load',
      { sessionId, cwd, mcpServers: [], _meta: { kiro: { noReplay: true } } },
      this.timeouts.loadSession
    );
    void recordProcessGroups(gen.proc.child);
    gen.sessions.set(sessionId, { configOptions: result?.configOptions ?? [], opening: true });
    const meta = asRecord(result?._meta);
    const percent = asNumber(asRecord(meta?.contextUsage)?.usagePercentage);
    if (percent !== undefined) this.infoFor(gen, sessionId).contextPercent = percent;
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
    gen: Generation,
    method: string,
    params: unknown,
    timeoutMs: number
  ): Promise<T> {
    this.pendingRequests += 1;
    this.clearIdle();
    try {
      return await gen.conn.request<T>(method, params, { timeoutMs });
    } catch (error) {
      throw this.mapError(error);
    } finally {
      this.pendingRequests -= 1;
      this.scheduleIdle();
    }
  }

  private mapError(error: unknown): unknown {
    if (error instanceof AcpClosedError) return new KiroCrashedError('Kiro CLI stopped');
    if (
      error instanceof AcpError &&
      error.code === -32000 &&
      /authentication required/i.test(error.message)
    ) {
      return new KiroSignedOutError('Kiro CLI is not signed in');
    }
    return error;
  }

  /** set_config_option. The result is checked for Autopilot like every config change. */
  private async setConfig(
    gen: Generation,
    sessionId: string,
    configId: string,
    value: string
  ): Promise<ConfigOption[]> {
    const result = await this.call<SetConfigOptionResult>(
      gen,
      'session/set_config_option',
      { sessionId, configId, value },
      this.timeouts.configOption
    );
    const options = result?.configOptions ?? [];
    const session = gen.sessions.get(sessionId);
    if (session && options.length) session.configOptions = options;
    const repair = this.checkSafe(gen, sessionId, options);
    if (repair) {
      await repair;
      if (gen.sessions.get(sessionId)?.unsafe !== undefined || !gen.sessions.has(sessionId)) {
        throw new KiroSessionError('Kiro did not turn off Autopilot');
      }
      return gen.sessions.get(sessionId)!.configOptions;
    }
    return options;
  }

  /**
   * Autopilot off (D7), read back from Kiro. When it stays on, a session that this call created
   * is deleted. A loaded session is never deleted: it stays on disk and is not live.
   */
  private async afterOpen(
    gen: Generation,
    sessionId: string,
    { created }: { created: boolean }
  ): Promise<void> {
    const session = gen.sessions.get(sessionId)!;
    try {
      if (autopilotOf(session.configOptions) !== 'off') {
        let ok = false;
        try {
          const result = await this.call<SetConfigOptionResult>(
            gen,
            'session/set_config_option',
            { sessionId, configId: 'autopilot', value: 'off' },
            this.timeouts.configOption
          );
          if (result?.configOptions?.length) session.configOptions = result.configOptions;
          ok = autopilotOf(session.configOptions) === 'off';
        } catch (error) {
          if (error instanceof KiroCrashedError) throw error;
        }
        if (!ok) {
          this.dropSession(gen, sessionId, session);
          if (created) {
            try {
              await this.call(gen, 'session/delete', { sessionId }, this.timeouts.deleteSession);
            } catch {
              // The session stays on disk; it is not live in the app
            }
          }
          throw new KiroSessionError('Kiro did not turn off Autopilot');
        }
      }
    } finally {
      session.opening = false;
    }
    // A config_option_update during the open may have turned it on again
    const repair = this.checkSafe(gen, sessionId, session.configOptions);
    if (repair) {
      await repair;
      if (!this.isLive(sessionId)) throw new KiroSessionError('Kiro did not turn off Autopilot');
    }
  }

  /**
   * Runs on every set_config_option result and every config_option_update. When Autopilot is not
   * off: cancel the session's reply, turn Autopilot off again, and keep the session not live until
   * Kiro reads back off. When that fails, the session is dropped (a later ensureSession loads it).
   */
  private checkSafe(
    gen: Generation,
    sessionId: string,
    options: ConfigOption[]
  ): Promise<void> | undefined {
    const session = gen.sessions.get(sessionId);
    if (!session || session.opening || gen.stopRequested) return undefined;
    if (session.unsafe) return session.unsafe;
    if (!options.length || autopilotOf(options) === 'off') return undefined;
    console.warn('[kiro] Autopilot turned on in a session, turning it off again');
    const active = this.prompts.get(sessionId);
    if (active?.gen === gen) void this.cancel(sessionId).catch(() => undefined);
    const repair = (async () => {
      let ok = false;
      try {
        const result = await this.call<SetConfigOptionResult>(
          gen,
          'session/set_config_option',
          { sessionId, configId: 'autopilot', value: 'off' },
          this.timeouts.configOption
        );
        if (result?.configOptions?.length) session.configOptions = result.configOptions;
        ok = autopilotOf(session.configOptions) === 'off';
      } catch {
        // Not off: the session is dropped below
      }
      if (gen.sessions.get(sessionId) !== session) return;
      if (ok) session.unsafe = undefined;
      else this.dropSession(gen, sessionId, session);
    })();
    session.unsafe = repair;
    return repair;
  }

  private dropSession(gen: Generation, sessionId: string, session: Session): void {
    if (gen.sessions.get(sessionId) !== session) return;
    gen.sessions.delete(sessionId);
    gen.info.delete(sessionId);
  }

  private infoFor(gen: Generation, sessionId: string): KiroSessionInfo {
    let info = gen.info.get(sessionId);
    if (!info) gen.info.set(sessionId, (info = {}));
    return info;
  }

  // --- from Kiro ---

  private onNotification(gen: Generation, method: string, params: unknown): void {
    if (method !== 'session/update') return;
    const { sessionId, update } = (params ?? {}) as Partial<SessionNotification>;
    if (typeof sessionId !== 'string' || !update || typeof update.sessionUpdate !== 'string')
      return;
    if (update.sessionUpdate === 'config_option_update') {
      const session = gen.sessions.get(sessionId);
      const options = (update as { configOptions?: unknown }).configOptions;
      if (session && Array.isArray(options)) {
        session.configOptions = options as ConfigOption[];
        void this.checkSafe(gen, sessionId, session.configOptions);
      }
    } else if (update.sessionUpdate === 'session_info_update') {
      this.noteInfo(gen, sessionId, update);
    }
    const active = this.prompts.get(sessionId);
    if (active && active.gen === gen) active.onUpdate(update);
  }

  private noteInfo(gen: Generation, sessionId: string, update: SessionUpdate): void {
    const kiro = asRecord(asRecord(update._meta)?.kiro);
    if (!kiro) return;
    const kind = kiro.kind;
    if (kind === 'context_usage' || (kind === undefined && kiro.contextUsage)) {
      const percent =
        asNumber(kiro.usagePercentage) ?? asNumber(asRecord(kiro.contextUsage)?.usagePercentage);
      if (percent !== undefined) this.infoFor(gen, sessionId).contextPercent = percent;
    } else if (kind === 'focus_update') {
      const title = typeof kiro.title === 'string' ? kiro.title : update.title;
      if (typeof title === 'string' && title) this.infoFor(gen, sessionId).title = title;
    } else if (kind === 'session_usage' && Array.isArray(kiro.credits)) {
      const credit = kiro.credits.map(asRecord).find((c) => c?.unit === 'credit');
      const usage = asNumber(credit?.usage);
      if (usage !== undefined) this.infoFor(gen, sessionId).credits = usage;
    }
  }

  private async onPermission(
    gen: Generation,
    request: PermissionRequest
  ): Promise<PermissionOutcome> {
    const cancelled: PermissionOutcome = { outcome: { outcome: 'cancelled' } };
    const options = Array.isArray(request?.options) ? request.options : [];
    const reject = (): PermissionOutcome => {
      const optionId = options.find((o) => o.kind === 'reject_once')?.optionId;
      return optionId ? { outcome: { outcome: 'selected', optionId } } : cancelled;
    };
    const active = this.prompts.get(request?.sessionId);
    if (!active || active.gen !== gen || active.cancelled) return cancelled;
    const signal = active.controller.signal;
    const ask = async (): Promise<PermissionDecision> => {
      if (active.onPermission) {
        return active.onPermission({
          requestId: randomUUID(),
          toolCallId: String(request.toolCall?.toolCallId ?? ''),
          title: typeof request.toolCall?.title === 'string' ? request.toolCall.title : undefined,
          options,
          signal,
        });
      }
      return this.permissionHandler({
        sessionId: request.sessionId,
        request: { ...request, options },
        signal,
      });
    };
    let timer: NodeJS.Timeout | undefined;
    // A handler that never answers must not hold the reply: cancel and a timeout answer for it
    const answer = await Promise.race([
      ask().then(
        (decision) => ({ decision }),
        () => 'failed' as const
      ),
      aborted(signal).then(() => 'cancelled' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), this.permissionTimeoutMs);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
    if (active.cancelled || answer === 'cancelled') return cancelled;
    if (answer === 'failed' || answer === 'timeout') return reject();
    const { decision } = answer;
    if (decision === 'cancelled') return cancelled;
    if (!options.some((o) => o.optionId === decision.optionId)) return reject();
    return { outcome: { outcome: 'selected', optionId: decision.optionId } };
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
      console.log('[kiro] agent idle');
      void this.stopGeneration(gen);
    }, this.idleMs);
    this.idleTimer.unref();
  }
}

let instance: KiroAgent | undefined;

/** The one Kiro agent of the app */
export function getKiroAgent(): KiroAgent {
  instance ??= new KiroAgent();
  return instance;
}

/**
 * For the server close: stops the Kiro agent for good. A caller that still holds it gets
 * "Kiro is stopping". The next getKiroAgent() makes a new agent, because Vite can start a new
 * server in the same process (for example after a change to vite.config.ts).
 */
export async function shutdownKiroAgent(): Promise<void> {
  const current = instance;
  if (!current) return;
  instance = undefined;
  await current.close();
}
