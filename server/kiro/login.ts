/**
 * Signs in and out of Kiro CLI.
 *
 * `kiro-cli login --use-device-flow` prints a code and a URL, then waits until the person
 * approves in a browser. The arguments come only from a validated method: no shell, no free text.
 * The code and the URL go to the caller through the events and never to the log.
 *
 * The login runs as its own process group (`detached`), because ~/.local/bin/kiro-cli can be a
 * wrapper that starts other processes. Stopping it kills the whole group, and so does the end of
 * the login (any exit code) and the end of the dev server (also Ctrl+C or a closed terminal).
 */
import { type ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { StringDecoder } from 'string_decoder';

import { isAllowedSignInUrl, parseLoginLine } from '../../src/utils/kiroLogin.ts';
import type { KiroLoginEvent, KiroLoginMethod } from '../../src/utils/kiroLogin.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { defaultKiroEnvironment, resolveKiroBinary } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import { onProcessEnd } from './process-end.ts';
import { runKiro, stripAnsi } from './run.ts';

const DEFAULT_TIMEOUT_MS = 600_000;
const KILL_GRACE_MS = 3_000;
/** After `exit`, how long to wait for the output pipes to close */
const CLOSE_WAIT_MS = 250;
const LOGOUT_TIMEOUT_MS = 15_000;
/** The longest line that is kept while it waits for its line break */
const MAX_LINE_LENGTH = 8_192;

export interface KiroLoginOptions {
  environment?: KiroEnvironment;
  statusReader: { read(refresh?: boolean): Promise<KiroStatus> };
  /** How long a sign-in may wait for the approval */
  timeoutMs?: number;
}

export interface KiroLogin {
  /** Resolves when the sign-in ends. Rejects with KiroLoginBusyError when one already runs. */
  start(method: KiroLoginMethod, onEvent: (event: KiroLoginEvent) => void): Promise<void>;
  /**
   * Stops the running sign-in. With a run id, only when it is that run. Returns false when none
   * (or another one) runs.
   */
  cancel(runId?: string): boolean;
  isRunning(): boolean;
  /** True while `kiro-cli logout` runs */
  isSigningOut(): boolean;
  logout(): Promise<KiroStatus>;
  /** Stops a running sign-in without events, for the end of the server */
  close(): void;
}

export const LOGIN_BUSY_MESSAGE = 'A sign-in is already running';
export const LOGOUT_BUSY_MESSAGE = 'Signing out. Try again in a moment.';

/** A sign-in or a sign-out runs already. The message says which. */
export class KiroLoginBusyError extends Error {
  constructor(message = LOGIN_BUSY_MESSAGE) {
    super(message);
    this.name = 'KiroLoginBusyError';
  }
}

// ─── Process groups ──────────────────────────────────────────────────────────

/** Groups that may still have a process: from the spawn until their SIGKILL has run */
const liveGroups = new Set<ChildProcess>();
let removeEndHandler: (() => void) | undefined;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // ESRCH: the group is gone already
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    try {
      child.kill(signal);
    } catch {
      // Nothing left to stop
    }
  }
}

function addGroup(child: ChildProcess): void {
  liveGroups.add(child);
  // Kills each live group when the server process ends: exit, Ctrl+C, or a closed terminal
  removeEndHandler ??= onProcessEnd(() => {
    for (const group of liveGroups) killGroup(group, 'SIGKILL');
  });
}

/** Kills what is left of the group, and forgets it */
function endGroup(child: ChildProcess): void {
  killGroup(child, 'SIGKILL');
  liveGroups.delete(child);
  if (liveGroups.size === 0 && removeEndHandler) {
    removeEndHandler();
    removeEndHandler = undefined;
  }
}

// ─── Output ──────────────────────────────────────────────────────────────────

/** The spinner that kiro-cli draws while it waits: "▰▱▱ Logging in..." */
function isSpinnerLine(line: string): boolean {
  return /[▰▱]/.test(line) || /^\W*Logging in\W*$/i.test(line);
}

/** A line that says what went wrong: `error: …`, an exception, or "Already logged in" */
function isErrorLine(line: string): boolean {
  return /^error:/i.test(line) || /Exception/.test(line) || /already logged in/i.test(line);
}

function errorMessageFrom(line: string | undefined): string {
  if (!line) return 'Sign-in failed';
  if (/InvalidRequestException/i.test(line)) return 'The start URL or the Region is not correct';
  if (/already logged in/i.test(line)) return 'Already signed in';
  return line.replace(/^error:\s*/i, '').slice(0, 200) || 'Sign-in failed';
}

/** Collects complete lines from a stream, split on \n and \r, with ANSI codes removed */
function createLineReader(onLine: (line: string) => void) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const emit = (raw: string) => onLine(stripAnsi(raw).trim());
  return {
    push(chunk: Buffer) {
      pending += decoder.write(chunk);
      const parts = pending.split(/[\n\r]/);
      pending = parts.pop() ?? '';
      if (pending.length > MAX_LINE_LENGTH) pending = '';
      for (const part of parts) emit(part);
    },
    flush() {
      pending += decoder.end();
      if (pending) emit(pending);
      pending = '';
    },
  };
}

// ─── The login ───────────────────────────────────────────────────────────────

type EndEvent = Extract<KiroLoginEvent, { state: 'done' | 'error' }>;

interface Run {
  id: string;
  child?: ChildProcess;
  /** Sends the end event, once. Later events and output are ignored. */
  finish(event: EndEvent): void;
  /** Sends a progress event, unless the run ended */
  emit(event: KiroLoginEvent): void;
  /** The end event is sent */
  finished: boolean;
  cancelled: boolean;
  /** close() ran: no more events */
  closed: boolean;
  terminating: boolean;
  killTimer?: ReturnType<typeof setTimeout>;
  outcome: 'done' | 'error' | 'closed';
}

function loginArgs(method: KiroLoginMethod): string[] {
  if (method.method === 'builder-id') return ['login', '--license', 'free', '--use-device-flow'];
  return [
    'login',
    '--license',
    'pro',
    '--identity-provider',
    method.startUrl,
    '--region',
    method.region,
    '--use-device-flow',
  ];
}

export function createKiroLogin(options: KiroLoginOptions): KiroLogin {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const environment = () => options.environment ?? defaultKiroEnvironment();
  let active: Run | undefined;
  // One busy slot: a sign-in and a sign-out never run at the same time
  let signingOut = false;

  function terminate(run: Run): void {
    const child = run.child;
    if (!child || run.terminating) return;
    run.terminating = true;
    killGroup(child, 'SIGTERM');
    // Not cleared when the child exits: a process in the group can outlive the wrapper
    run.killTimer = setTimeout(() => endGroup(child), KILL_GRACE_MS);
    run.killTimer.unref();
  }

  async function execute(run: Run, method: KiroLoginMethod): Promise<void> {
    const { finish, emit } = run;
    const cancelledNow = (): boolean => {
      if (!run.cancelled) return false;
      finish({ state: 'error', message: 'Sign-in cancelled' });
      return true;
    };

    const env = environment();
    const binary = await resolveKiroBinary(env);
    if (run.closed || cancelledNow()) return;
    if (!binary) return finish({ state: 'error', message: 'Kiro CLI is not installed' });
    if ('error' in binary) return finish({ state: 'error', message: binary.error });

    const status = await options.statusReader.read(true);
    if (run.closed || cancelledNow()) return;
    switch (status.state) {
      case 'signed-in':
        return finish({ state: 'error', message: 'Already signed in' });
      case 'unsupported':
        return finish({ state: 'error', message: 'Update Kiro CLI to version 3' });
      case 'not-installed':
        return finish({ state: 'error', message: 'Kiro CLI is not installed' });
      case 'error':
        return finish({ state: 'error', message: `Kiro CLI does not run: ${status.message}` });
      case 'signed-out':
        break;
    }

    const startUrl = method.method === 'identity-center' ? method.startUrl : undefined;
    const region = method.method === 'identity-center' ? method.region : undefined;
    let child: ChildProcess;
    try {
      child = spawn(binary.path, loginArgs(method), {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: { ...env.env, NO_COLOR: '1' },
        windowsHide: true,
      });
    } catch {
      return finish({ state: 'error', message: 'Could not start Kiro CLI' });
    }
    run.child = child;
    addGroup(child);

    let code: string | undefined;
    let url: string | undefined;
    let codeSent = false;
    let errorLine: string | undefined;

    const onLine = (line: string): void => {
      if (!line || run.finished) return;
      const parsed = parseLoginLine(line);
      if (!parsed) {
        // Instructions and the spinner are never the error
        if (!isSpinnerLine(line) && isErrorLine(line)) errorLine = line;
        return;
      }
      if ('code' in parsed) code = parsed.code;
      else url = parsed.url;
      if (url && !isAllowedSignInUrl(url, startUrl, region)) {
        terminate(run);
        finish({
          state: 'error',
          message: 'Kiro CLI sent a sign-in page that the app does not trust',
        });
        return;
      }
      if (code && url && !codeSent) {
        codeSent = true;
        emit({ state: 'code', code, url });
      }
    };
    const readers = [createLineReader(onLine), createLineReader(onLine)];
    child.stdout?.on('data', (chunk: Buffer) => readers[0].push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => readers[1].push(chunk));

    let spawnFailed = false;
    const exited = new Promise<{ code: number | null }>((resolve) => {
      let settled = false;
      const settle = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        resolve({ code: exitCode });
      };
      child.once('error', () => {
        spawnFailed = true;
        settle(null);
      });
      child.once('exit', (exitCode) => {
        // The pipes can stay open when a process of the group lives on
        setTimeout(() => settle(exitCode), CLOSE_WAIT_MS).unref();
      });
      child.once('close', (exitCode) => settle(exitCode));
    });

    const timer = setTimeout(() => {
      if (run.finished) return;
      terminate(run);
      finish({ state: 'error', message: 'Sign-in timed out' });
    }, timeoutMs);

    emit({ state: 'started', runId: run.id });

    try {
      const result = await exited;
      for (const reader of readers) reader.flush();
      // A process of the group (a wrapper's child) must not keep the device flow open
      if (run.killTimer) clearTimeout(run.killTimer);
      endGroup(child);
      if (run.finished) return;
      if (spawnFailed) return finish({ state: 'error', message: 'Could not start Kiro CLI' });
      if (result.code !== 0) {
        return finish({ state: 'error', message: errorMessageFrom(errorLine) });
      }
      try {
        const signedIn = await options.statusReader.read(true);
        finish({ state: 'done', status: signedIn });
      } catch {
        finish({ state: 'error', message: 'Signed in, but the status could not be read' });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async start(method, onEvent) {
      if (active) throw new KiroLoginBusyError();
      if (signingOut) throw new KiroLoginBusyError(LOGOUT_BUSY_MESSAGE);
      const run: Run = {
        id: randomUUID(),
        finished: false,
        cancelled: false,
        closed: false,
        terminating: false,
        outcome: 'error',
        emit(event) {
          if (run.finished || run.closed) return;
          try {
            onEvent(event);
          } catch {
            // The listener is gone (the response closed)
          }
        },
        finish(event) {
          if (run.finished) return;
          run.finished = true;
          run.outcome = event.state;
          if (run.closed) return;
          try {
            onEvent(event);
          } catch {
            // The listener is gone
          }
        },
      };
      // Reserved before the first await, so a second start cannot slip in
      active = run;
      console.info('[kiro] sign-in started');
      try {
        await execute(run, method);
      } catch (error) {
        console.warn('[kiro] sign-in failed:', error instanceof Error ? error.message : error);
        run.finish({ state: 'error', message: 'Could not start the sign-in' });
        terminate(run);
      } finally {
        if (active === run) active = undefined;
        console.info(`[kiro] sign-in ended: ${run.closed ? 'closed' : run.outcome}`);
      }
    },

    cancel(runId) {
      const run = active;
      if (!run || run.finished) return false;
      if (runId !== undefined && runId !== run.id) return false;
      run.cancelled = true;
      // Before the process starts, execute() sees the flag and ends the run
      if (run.child) {
        terminate(run);
        run.finish({ state: 'error', message: 'Sign-in cancelled' });
      }
      return true;
    },

    isRunning: () => active !== undefined,
    isSigningOut: () => signingOut,

    async logout() {
      if (active) throw new KiroLoginBusyError('A sign-in is running. Cancel it first.');
      if (signingOut) throw new KiroLoginBusyError(LOGOUT_BUSY_MESSAGE);
      // Taken before the first await, so a sign-in cannot start in between
      signingOut = true;
      try {
        const env = environment();
        const binary = await resolveKiroBinary(env);
        if (!binary || 'error' in binary) return await options.statusReader.read(true);
        let failure: string | undefined;
        try {
          const result = await runKiro(binary.path, ['logout'], {
            timeoutMs: LOGOUT_TIMEOUT_MS,
            env: env.env,
          });
          if (result.code !== 0) failure = 'Kiro CLI could not sign out';
        } catch (error) {
          failure = `Sign-out failed: ${error instanceof Error ? error.message : 'unknown error'}`;
        }
        const status = await options.statusReader.read(true);
        if (failure && status.state === 'signed-in') throw new Error(failure);
        return status;
      } finally {
        signingOut = false;
      }
    },

    close() {
      const run = active;
      if (!run) return;
      run.closed = true;
      run.finished = true;
      terminate(run);
    },
  };
}
