/**
 * Reads the state of kiro-cli: installed, supported version, signed in or out.
 * Only `--version` and `whoami` run. Neither changes any state.
 */
import {
  type KiroStatus,
  isSupportedKiroVersion,
  parseKiroVersion,
  parseKiroWhoami,
} from '../../src/utils/kiroStatus.ts';
import { defaultKiroEnvironment, displayPath, resolveKiroBinary } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import { runKiro } from './run.ts';
import type { RunResult } from './run.ts';

const DEFAULT_CACHE_MS = 30_000;

export interface KiroStatusReaderOptions {
  environment?: KiroEnvironment;
  cacheMs?: number;
  now?: () => number;
  timeouts?: { versionMs?: number; whoamiMs?: number };
}

export interface KiroStatusReader {
  read(refresh?: boolean): Promise<KiroStatus>;
}

/** The first non-empty line of stderr, else of stdout, at most 200 characters */
function firstLine(result: RunResult): string {
  for (const text of [result.stderr, result.stdout]) {
    const line = text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    if (line) return line.slice(0, 200);
  }
  return 'no output';
}

export function createKiroStatusReader(options: KiroStatusReaderOptions = {}): KiroStatusReader {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const now = options.now ?? Date.now;
  const versionMs = options.timeouts?.versionMs ?? 5_000;
  const whoamiMs = options.timeouts?.whoamiMs ?? 15_000;

  let cached: { status: KiroStatus; at: number } | undefined;
  let inFlight: Promise<KiroStatus> | undefined;

  async function load(): Promise<KiroStatus> {
    const environment = options.environment ?? defaultKiroEnvironment();
    const { env, home } = environment;
    const binary = await resolveKiroBinary(environment);
    if (!binary) return { state: 'not-installed' };
    if ('error' in binary) {
      return {
        state: 'error',
        path: displayPath(env.LOCAL_LLM_UI_KIRO_CLI ?? '', home),
        message: binary.error,
      };
    }
    const path = displayPath(binary.path, home);
    const fail = (message: string): KiroStatus => ({ state: 'error', path, message });

    let versionRun: RunResult;
    try {
      versionRun = await runKiro(binary.path, ['--version'], { timeoutMs: versionMs, env });
    } catch (error) {
      return fail(`kiro-cli --version ${error instanceof Error ? error.message : 'failed'}`);
    }
    const version = parseKiroVersion(versionRun.stdout);
    if (!version) return fail(`Could not read the version: ${firstLine(versionRun)}`);
    if (!isSupportedKiroVersion(version)) return { state: 'unsupported', path, version };

    let whoamiRun: RunResult;
    try {
      whoamiRun = await runKiro(binary.path, ['whoami', '-f', 'json'], {
        timeoutMs: whoamiMs,
        env,
      });
    } catch (error) {
      return fail(`kiro-cli whoami ${error instanceof Error ? error.message : 'failed'}`);
    }
    const account = parseKiroWhoami(whoamiRun.stdout);
    if (account === null) return { state: 'signed-out', path, version };
    if (account === undefined) {
      return fail(`Could not read the sign-in state: ${firstLine(whoamiRun)}`);
    }
    return { state: 'signed-in', path, version, account };
  }

  async function loadSafely(): Promise<KiroStatus> {
    let status: KiroStatus;
    try {
      status = await load();
    } catch (error) {
      status = {
        state: 'error',
        path: '',
        message: error instanceof Error ? error.message : 'Could not check Kiro CLI',
      };
    }
    // Never log the account or the email
    if (status.state === 'error') console.warn(`[kiro] ${status.message}`);
    cached = { status, at: now() };
    return status;
  }

  return {
    read(refresh = false) {
      if (inFlight) return inFlight;
      if (!refresh && cached && now() - cached.at < cacheMs) {
        return Promise.resolve(cached.status);
      }
      inFlight = loadSafely().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
