/**
 * The account credits for POST /api/kiro/usage.
 *
 * `_kiro/account/getUsage` needs no session and answers in about 300 ms, but it can start
 * `kiro-cli acp` (and the user's MCP servers). The result is kept 5 minutes per account, and
 * one call runs at a time. A signed-out Kiro never starts the process.
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

  let cached: { usage: KiroUsage; at: number } | undefined;
  /** The account of the cached result, to drop it when the account changes. Never logged. */
  let account: string | undefined;
  let loading: Promise<KiroUsage | null> | undefined;

  async function load(): Promise<KiroUsage | null> {
    try {
      const usage = parseKiroUsage(await agent.extension<unknown>(GET_USAGE, {}));
      if (usage) cached = { usage, at: now() };
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
      if (account !== undefined && key !== account) cached = undefined;
      account = key;

      if (cached && now() - cached.at < ttlMs) return cached.usage;
      loading ??= load().finally(() => {
        loading = undefined;
      });
      return loading;
    },
  };
}
