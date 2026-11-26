/**
 * The Kiro model list for POST /api/kiro/models.
 *
 * Kiro lists its models only in the config options of a session, so a load makes a session,
 * reads the options, and deletes the session again. The list is cached for an hour: one
 * `kiro-cli acp` start runs the user's MCP servers (20 to 26 processes), and each load makes and
 * deletes a session. The chat route calls `update()` with the options of each session that it
 * opens, so a chat keeps the list fresh without new sessions.
 *
 * The session options (the agent, Autopilot, …) of the load's new session are Kiro's defaults
 * for a new chat. Only a load sets them: a chat session holds the user's values, so `update()`
 * keeps them as they are.
 */
import { parseKiroModels } from '../../src/utils/kiroModels.ts';
import type { KiroModel } from '../../src/utils/kiroModels.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import type { SessionOptionsSnapshot } from '../../src/utils/sessionOptions.ts';
import { KiroSignedOutError } from './agent.ts';
import type { KiroAgent } from './agent.ts';
import { kiroSessionOptions } from './chat-options.ts';

export type KiroModelListResult =
  | {
      state: 'ok';
      models: KiroModel[];
      /** The agent and options of a new session: Kiro's defaults for a new chat (K9) */
      sessionOptions?: SessionOptionsSnapshot;
    }
  | { state: 'unavailable'; models: [] }
  | { state: 'signed-out'; models: [] }
  | { state: 'error'; message: string; models: [] };

/** The browser's text for a model list that failed; the detail goes to the terminal */
export const KIRO_MODELS_FAILED =
  'Kiro could not list its models. See the terminal that runs npm run dev.';

export interface KiroModelList {
  list(refresh?: boolean): Promise<KiroModelListResult>;
  /** Replaces the cache with the models in these config options, when there are any */
  update(configOptions: unknown): void;
}

export interface KiroModelListOptions {
  agent: Pick<KiroAgent, 'newSession' | 'deleteSession'>;
  statusReader: { read(refresh?: boolean): Promise<KiroStatus> };
  ttlMs?: number;
  now?: () => number;
}

interface Loaded {
  models: KiroModel[];
  sessionOptions: SessionOptionsSnapshot;
}

export function createKiroModelList(options: KiroModelListOptions): KiroModelList {
  const { agent, statusReader } = options;
  const ttlMs = options.ttlMs ?? 3_600_000;
  const now = options.now ?? Date.now;

  let cached: { models: KiroModel[]; at: number } | undefined;
  let loading: Promise<Loaded> | undefined;
  /** Kiro's defaults for a new chat, from the last load */
  let defaults: SessionOptionsSnapshot | undefined;
  /** The account of the cached list, to drop it when the account changes. Never logged. */
  let account: string | undefined;

  async function load(): Promise<Loaded> {
    const { sessionId, configOptions } = await agent.newSession();
    try {
      return {
        models: parseKiroModels(configOptions),
        sessionOptions: kiroSessionOptions(configOptions),
      };
    } finally {
      try {
        await agent.deleteSession(sessionId);
      } catch (error) {
        console.warn(
          '[kiro] could not delete the model-list session:',
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  return {
    async list(refresh = false) {
      const status = await statusReader.read(refresh);
      if (status.state !== 'signed-in') {
        // A sign-out, or a Kiro CLI that is gone: the next account may have other models
        cached = undefined;
        defaults = undefined;
        account = undefined;
      } else {
        // The account type and email: an API key has no email
        const key = `${status.account.type}:${status.account.email ?? ''}`;
        if (account !== undefined && key !== account) {
          cached = undefined;
          defaults = undefined;
        }
        account = key;
      }
      if (status.state === 'not-installed' || status.state === 'unsupported') {
        return { state: 'unavailable', models: [] };
      }
      if (status.state === 'signed-out') return { state: 'signed-out', models: [] };
      if (status.state === 'error') {
        console.warn(`[kiro] model list failed: could not check Kiro CLI: ${status.message}`);
        return { state: 'error', message: KIRO_MODELS_FAILED, models: [] };
      }

      if (!refresh && !loading && cached && now() - cached.at < ttlMs) {
        return {
          state: 'ok',
          models: cached.models,
          ...(defaults && { sessionOptions: defaults }),
        };
      }
      loading ??= load()
        .then((loaded) => {
          // An empty list is not kept: the next request tries again
          cached = loaded.models.length > 0 ? { models: loaded.models, at: now() } : undefined;
          defaults = loaded.sessionOptions;
          return loaded;
        })
        .finally(() => {
          loading = undefined;
        });
      try {
        const loaded = await loading;
        return { state: 'ok', models: loaded.models, sessionOptions: loaded.sessionOptions };
      } catch (error) {
        if (error instanceof KiroSignedOutError) return { state: 'signed-out', models: [] };
        console.warn(
          `[kiro] model list failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'}`
        );
        return { state: 'error', message: KIRO_MODELS_FAILED, models: [] };
      }
    },

    update(configOptions) {
      const models = parseKiroModels(configOptions);
      if (models.length > 0) cached = { models, at: now() };
    },
  };
}
