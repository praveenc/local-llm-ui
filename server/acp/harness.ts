/**
 * The adapter interface between the generic ACP agent (agent.ts) and one product: how to start
 * the agent, its names in texts and logs, its error classes, and its own `_meta` fields.
 * Types only.
 */
import type { AcpError } from './client.ts';
import type {
  ConfigOption,
  InitializeResult,
  LoadSessionResult,
  Loose,
  SessionUpdate,
} from './types.ts';

/** The error classes that the generic agent throws; the harness makes the instances */
export type AgentErrorKind =
  | 'agent' // "<agent> is stopping", an extension method that is not allowed
  | 'not-installed'
  | 'signed-out'
  | 'session'
  | 'option'
  | 'busy'
  | 'crashed'
  | 'cancel-timeout';

export interface AgentLaunch {
  /** Absolute path; spawned with no shell */
  command: string;
  args: readonly string[];
  /** The process cwd */
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface HarnessNames {
  /** In messages about the agent: "<agent> is still answering in this chat" */
  agent: string;
  /** In messages about the program: "<cli> is not signed in" */
  cli: string;
  /** Log tag: "[<log>] agent started pid 123" */
  log: string;
}

/** What a SessionGuard can do with one session on the current process */
export interface GuardContext {
  readonly sessionId: string;
  configOptions(): ConfigOption[];
  /** session/set_config_option without the guard; updates configOptions() when the result has options */
  setConfig(configId: string, value: string): Promise<ConfigOption[]>;
  /** session/cancel of the reply that runs in this session on this process, if any */
  cancelReply(): void;
  /** The session stops being live on this process. It stays on disk. */
  drop(): void;
  /** session/delete. Errors go to the caller. */
  deleteSession(): Promise<void>;
  /** False once the session was dropped or the process changed */
  isCurrent(): boolean;
}

/**
 * Rules for the config options of a session. The generic agent runs them and keeps the session
 * not live while a check runs. Absent: no rules.
 */
export interface SessionGuard {
  /** setOption() rejects this id, and ensureSession() drops it from the wanted options */
  isLocked(configId: string): boolean;
  /**
   * After session/new or session/load, while the session is still opening. Throw to refuse it.
   * `created` is true when this call made the session (the guard may delete it).
   */
  afterOpen(ctx: GuardContext, created: boolean): Promise<void>;
  /**
   * On every set_config_option result and every config_option_update of an open session.
   * Return a promise to keep the session not live until it settles (call ctx.drop() inside on
   * failure), or undefined when the options are fine.
   */
  check(ctx: GuardContext, options: ConfigOption[]): Promise<void> | undefined;
  /** Thrown when a check ended with the session dropped */
  refused(): Error;
}

export interface AcpHarness<TInfo extends object> {
  readonly names: HarnessNames;
  /** How to start the agent. Throws a 'not-installed' error when it cannot. */
  launch(): Promise<AgentLaunch>;
  /**
   * The cwd of session/new when the caller gives none: created and checked by the harness.
   * Never a value from the browser.
   */
  workspaceDir(): Promise<string>;
  /**
   * True when the initialize result says that the agent is signed out. The result is null when
   * the agent answers with null. If this throws, the agent stops the process and passes the error on.
   */
  signedOut(init: InitializeResult | null): boolean;
  /** True for an error answer that means "signed out" */
  isSignedOutError(error: AcpError): boolean;
  createError(kind: AgentErrorKind, message: string): Error;
  /** The extension methods that AcpAgent.extension() may call */
  readonly extensionMethods: readonly string[];
  /** `_meta` of every session/load request */
  readonly loadMeta?: Loose;
  readonly guard?: SessionGuard;
  /** Keeps per-session info (context, title, …) from the agent's own fields */
  readonly sessionInfo: {
    /** Called for each session_info_update, also outside a prompt */
    fromUpdate(update: SessionUpdate, info: TInfo): void;
    /** Called with the session/load result */
    fromLoad(result: LoadSessionResult, info: TInfo): void;
  };
}
