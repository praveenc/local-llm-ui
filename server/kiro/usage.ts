/**
 * The account credits for POST /api/kiro/usage.
 *
 * `_kiro/account/getUsage` needs no session and answers in about 300 ms, but it can start
 * `kiro-cli acp` (and the user's MCP servers). The result is kept 5 minutes per account, and
 * one call runs at a time for each account. A call keeps the account that was current when it
 * started, and its result is kept only when that account is still the current one at its end. A signed-out Kiro never starts the process.
 *
 * Any failure gives null ("not available"), is not kept, and logs one line with the error class
 * only. The account data (plan, credits, email) is never logged.
 */
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { parseKiroUsage } from '../../src/utils/kiroUsage.ts';
import type { KiroUsage } from '../../src/utils/kiroUsage.ts';
import type { KiroAgent } from './agent.ts';

export interface KiroUsageReader {
  /** The account credits, or null when Kiro is signed out, missing, or cannot tell */
  read(): Promise<KiroUsage | null>;
}

export interface KiroUsageReaderOptions {
  agent: Pick<KiroAgent, 'extension'>;
  statusReader: { read(refresh?: boolean): Promise<KiroStatus> };
  ttlMs?: number;
  now?: () => number;
}

const GET_USAGE = '_kiro/account/getUsage';

export function createKiroUsage(options: KiroUsageReaderOptions): KiroUsageReader {
  const { agent, statusReader } = options;
  const ttlMs = options.ttlMs ?? 300_000;
  const now = options.now ?? Date.now;

  /** The last result and the account that it is for. Never logged. */
  let cached: { usage: KiroUsage; at: number; key: string } | undefined;
  /** The account of the last read, to drop the result when the account changes. Never logged. */
  let account: string | undefined;
  /** The running call and the account that it started for */
  let loading: { key: string; promise: Promise<KiroUsage | null> } | undefined;

  async function load(key: string): Promise<KiroUsage | null> {
    try {
      const usage = parseKiroUsage(await agent.extension<unknown>(GET_USAGE, {}));
      // A call for an account that is no longer the current one keeps nothing
      if (usage && account === key) cached = { usage, at: now(), key };
      return usage;
    } catch (error) {
      console.warn(`[kiro] account usage failed: ${error instanceof Error ? error.name : 'error'}`);
      return null;
    }
  }

  return {
    async read() {
      let status: KiroStatus;
      try {
        status = await statusReader.read();
      } catch {
        return null;
      }
      if (status.state !== 'signed-in') {
        cached = undefined;
        account = undefined;
        return null;
      }
      const key = `${status.account.type}:${status.account.email ?? ''}`;
      if (cached && cached.key !== key) cached = undefined;
      account = key;

      if (cached && now() - cached.at < ttlMs) return cached.usage;
      // Share a running call only when it is for this account
      if (loading?.key === key) return loading.promise;
      const run = {
        key,
        promise: load(key).finally(() => {
          if (loading === run) loading = undefined;
        }),
      };
      loading = run;
      return run.promise;
    },
  };
}
