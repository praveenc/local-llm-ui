/**
 * The Kiro adapter of the ACP agent: how to start `kiro-cli acp`, Kiro's names, errors, folder,
 * signed-out rules, and the `_meta.kiro` fields that the agent keeps per session.
 */
import { chmod, mkdir, stat } from 'fs/promises';

import type { AcpHarness, AgentErrorKind } from '../acp/harness.ts';
import { defaultKiroEnvironment, resolveKiroBinary } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import {
  KiroBusyError,
  KiroCancelTimeoutError,
  KiroCrashedError,
  KiroError,
  KiroNotInstalledError,
  KiroOptionError,
  KiroSessionError,
  KiroSignedOutError,
} from './errors.ts';
import { createKiroSettings, defaultKiroDir, getKiroSettings } from './settings.ts';
import type { KiroSettings } from './settings.ts';

/**
 * The options that the app's controls set by id (chat-options.ts): the model picker sets `model`,
 * and the Thinking menu sets `effortLevel` and `thinking` (D8). Kiro gives the first two the ACP
 * categories `model` and `thought_level`; kiro-cli 3.6.2 gives `thinking` the category
 * `thinking`, which ACP does not define. The ids cover every version.
 */
export const KIRO_APP_OWNED_OPTION_IDS: readonly string[] = ['model', 'effortLevel', 'thinking'];

export const KIRO_ACP_ARGS = ['acp', '--agent-engine', 'v3', '--auth-method', 'cli'];

/** The Kiro extension methods that `extension()` may call */
export const KIRO_EXTENSION_METHODS: readonly string[] = ['_kiro/account/getUsage'];

/** What the app knows of a live session, also from updates outside a prompt */
export interface KiroSessionInfo {
  /** Percent of the context window, from context_usage or the session/load result */
  contextPercent?: number;
  /** From focus_update */
  title?: string;
  /** The session's credits as Kiro reports them in session_usage */
  credits?: number;
}

export interface KiroHarnessOptions {
  environment?: KiroEnvironment;
  resolveBinary?: typeof resolveKiroBinary;
  /** A fixed default folder (tests). With it, the stored setting is not read. */
  workspaceDir?: string;
  /** The folder for new chats (D6, SEC-21). Default: the settings of the environment's home. */
  settings?: Pick<KiroSettings, 'workspaceDir'>;
}

const ERRORS: Record<AgentErrorKind, new (message: string) => KiroError> = {
  agent: KiroError,
  'not-installed': KiroNotInstalledError,
  'signed-out': KiroSignedOutError,
  session: KiroSessionError,
  option: KiroOptionError,
  busy: KiroBusyError,
  crashed: KiroCrashedError,
  'cancel-timeout': KiroCancelTimeoutError,
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function createKiroHarness(options: KiroHarnessOptions = {}): AcpHarness<KiroSessionInfo> {
  let defaultReady: Promise<string> | undefined;
  const environment = () => options.environment ?? defaultKiroEnvironment();
  // The stored folder is not used with a fixed folder. The settings module keeps the value.
  const settings: Pick<KiroSettings, 'workspaceDir'> | undefined =
    options.settings ??
    (options.workspaceDir !== undefined
      ? undefined
      : options.environment
        ? createKiroSettings({
            home: options.environment.home,
            platform: options.environment.platform,
          })
        : getKiroSettings());

  /** The app's own folder: the process cwd, and new sessions when no folder is stored */
  const defaultDir = (): Promise<string> => {
    if (!defaultReady) {
      const dir = options.workspaceDir ?? defaultKiroDir(environment().home);
      defaultReady = (async () => {
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
        defaultReady = undefined;
        throw error;
      });
    }
    return defaultReady;
  };

  /**
   * The cwd of session/new: the folder that the user stored in Preferences, else the default.
   * Loaded sessions keep their own folder (chat.ts, session-files.ts).
   */
  const workspaceDir = async (): Promise<string> =>
    (await settings?.workspaceDir()) ?? (await defaultDir());

  return {
    names: { agent: 'Kiro', cli: 'Kiro CLI', log: 'kiro' },

    async launch() {
      const binary = await (options.resolveBinary ?? resolveKiroBinary)(environment());
      if (!binary) throw new KiroNotInstalledError('Kiro CLI is not installed');
      if ('error' in binary) throw new KiroNotInstalledError(binary.error);
      // The process stays in the app's own folder, so that a change of the setting needs no restart
      const cwd = await defaultDir();
      return { command: binary.path, args: KIRO_ACP_ARGS, cwd, env: environment().env };
    },

    workspaceDir,

    signedOut: (init) => init?.authMethods?.some((m) => m.id === 'kiro-login') === true,

    isSignedOutError: (error) =>
      error.code === -32000 && /authentication required/i.test(error.message),

    createError: (kind, message) => new ERRORS[kind](message),

    extensionMethods: KIRO_EXTENSION_METHODS,

    loadMeta: { kiro: { noReplay: true } },

    sessionInfo: {
      fromUpdate(update, info) {
        const kiro = asRecord(asRecord(update._meta)?.kiro);
        if (!kiro) return;
        const kind = kiro.kind;
        if (kind === 'context_usage' || (kind === undefined && kiro.contextUsage)) {
          const percent =
            asNumber(kiro.usagePercentage) ??
            asNumber(asRecord(kiro.contextUsage)?.usagePercentage);
          if (percent !== undefined) info.contextPercent = percent;
        } else if (kind === 'focus_update') {
          const title = typeof kiro.title === 'string' ? kiro.title : update.title;
          if (typeof title === 'string' && title) info.title = title;
        } else if (kind === 'session_usage' && Array.isArray(kiro.credits)) {
          const credit = kiro.credits.map(asRecord).find((c) => c?.unit === 'credit');
          const usage = asNumber(credit?.usage);
          if (usage !== undefined) info.credits = usage;
        }
      },
      fromLoad(result, info) {
        const meta = asRecord(result?._meta);
        const percent = asNumber(asRecord(meta?.contextUsage)?.usagePercentage);
        if (percent !== undefined) info.contextPercent = percent;
      },
    },
  };
}
