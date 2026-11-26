/**
 * The folder for new Kiro chats (D6, SEC-21): a server setting, never a field of the chat
 * request (SEC-16).
 *
 * The setting is stored in `~/.local-llm-ui/kiro-settings.json` (mode 0600, the folder 0700) as
 * `{ "workspaceDir": "<real path>" | null }`. No file, `null`, or a file that is not valid means
 * the default folder `~/.local-llm-ui/kiro`. The server never creates a folder other than the
 * default one (the harness creates that).
 *
 * `set` checks the typed text, then the disk: the real path must be a folder that the user owns
 * and can write to, and it must pass the place rules of `kiroFolderPlaceProblem`. A stored folder
 * is checked again each time a new session uses it, because the disk can change after the save;
 * a failure is a plain message, never a silent use of the default folder.
 *
 * Logs name the reason class only: no path and no file content.
 */
import { constants } from 'fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import path from 'path';

import {
  KIRO_FOLDER_MESSAGES,
  KIRO_SETTINGS_BODY_LIMIT,
  KIRO_SETTINGS_FOLDERS,
  checkKiroFolderText,
  displayKiroFolder,
  expandKiroFolder,
  kiroFolderPlaceProblem,
  parseKiroSettingsFile,
} from '../../src/utils/kiroSettings.ts';
import type { KiroFolderSetting } from '../../src/utils/kiroSettings.ts';
import { defaultKiroEnvironment } from './binary.ts';
import { KiroSessionError } from './errors.ts';

/** The message when a stored folder can no longer be used */
export const KIRO_FOLDER_UNAVAILABLE =
  'The folder for new Kiro chats is not available. Choose a different folder in Preferences.';

/** A stored folder that fails its check at the start of a new session */
export class KiroFolderError extends KiroSessionError {}

export type KiroSettingsResult =
  { ok: true; folder: KiroFolderSetting } | { ok: false; error: string };

export interface KiroSettings {
  /** The stored folder for a new session, checked again; undefined for the default folder */
  workspaceDir(): Promise<string | undefined>;
  /** The folder for display */
  folder(): Promise<KiroFolderSetting>;
  /** Checks and stores a folder, or goes back to the default with null */
  set(text: string | null): Promise<KiroSettingsResult>;
}

export interface KiroSettingsOptions {
  home: string;
  platform?: string;
  /** The user id that must own the folder. Tests set it; default `process.getuid()`. */
  uid?: number;
}

const SETTINGS_FOLDER = '.local-llm-ui';
const SETTINGS_FILE = 'kiro-settings.json';

/** The app's default Kiro folder, `~/.local-llm-ui/kiro` */
export const defaultKiroDir = (home: string): string => path.join(home, SETTINGS_FOLDER, 'kiro');

const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;

export function createKiroSettings(options: KiroSettingsOptions): KiroSettings {
  const { home } = options;
  const platform = options.platform ?? process.platform;
  const uid = () => options.uid ?? process.getuid?.();
  const settingsDir = path.join(home, SETTINGS_FOLDER);
  const settingsFile = path.join(settingsDir, SETTINGS_FILE);

  /** The stored folder: undefined until the first read, null for the default */
  let stored: Promise<string | null> | undefined;
  /** Writes run one at a time */
  let writing: Promise<unknown> = Promise.resolve();

  const realHome = () => realpath(home).catch(() => home);
  const realDefaultDir = async (real: string) =>
    realpath(defaultKiroDir(home)).catch(() => defaultKiroDir(real));

  async function readStored(): Promise<string | null> {
    try {
      const info = await lstat(settingsFile);
      const owner = uid();
      if (
        !info.isFile() ||
        info.size > KIRO_SETTINGS_BODY_LIMIT ||
        (owner !== undefined && info.uid !== owner)
      ) {
        console.warn('[kiro] settings file is not usable, using the default folder');
        return null;
      }
      const parsed = parseKiroSettingsFile(JSON.parse(await readFile(settingsFile, 'utf8')));
      if (!parsed) {
        console.warn('[kiro] settings file is not valid, using the default folder');
        return null;
      }
      return parsed.workspaceDir;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        console.warn('[kiro] could not read the settings file, using the default folder');
      }
      return null;
    }
  }

  const current = (): Promise<string | null> => (stored ??= readStored());

  /**
   * The disk checks and the place rules for an absolute path. Returns the real path, or the
   * message of the first check that fails.
   */
  async function check(absolute: string): Promise<{ real: string } | { error: string }> {
    let real: string;
    try {
      real = await realpath(absolute);
    } catch (error) {
      return {
        error:
          errorCode(error) === 'ENOTDIR'
            ? KIRO_FOLDER_MESSAGES.notFolder
            : KIRO_FOLDER_MESSAGES.notFound,
      };
    }
    const info = await stat(real).catch(() => undefined);
    if (!info) return { error: KIRO_FOLDER_MESSAGES.notFound };
    if (!info.isDirectory()) return { error: KIRO_FOLDER_MESSAGES.notFolder };
    // The place rules first: a system folder is not the user's either, and its message is clearer
    const homeReal = await realHome();
    // A settings folder can be a symlink: its real path counts too
    const realOf = async (name: string) => realpath(path.join(home, name)).catch(() => undefined);
    const settingsDirs = (
      await Promise.all(KIRO_SETTINGS_FOLDERS.filter((n) => n !== '.local-llm-ui').map(realOf))
    ).filter((dir): dir is string => !!dir);
    const appDir = await realOf('.local-llm-ui');
    const problem = kiroFolderPlaceProblem(real, {
      home: homeReal,
      platform,
      defaultDir: await realDefaultDir(homeReal),
      settingsDirs,
      appDirs: appDir ? [appDir] : [],
    });
    if (problem) return { error: problem };
    const owner = uid();
    if (owner !== undefined && info.uid !== owner) return { error: KIRO_FOLDER_MESSAGES.notOwned };
    try {
      await access(real, constants.W_OK | constants.X_OK);
    } catch {
      return { error: KIRO_FOLDER_MESSAGES.notWritable };
    }
    return { real };
  }

  /** Writes the settings file: a temp file 0600 in the same folder, then a rename */
  async function write(workspaceDir: string | null): Promise<void> {
    await mkdir(settingsDir, { recursive: true, mode: 0o700 });
    const info = await stat(settingsDir);
    const owner = uid();
    if (!info.isDirectory() || (owner !== undefined && info.uid !== owner)) {
      throw new Error('the settings folder belongs to another user');
    }
    // mkdir sets the mode only on a folder that it creates
    await chmod(settingsDir, 0o700);
    const temp = path.join(settingsDir, `.${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`);
    try {
      await writeFile(temp, `${JSON.stringify({ workspaceDir })}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temp, settingsFile);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function display(dir: string | null): Promise<KiroFolderSetting> {
    if (!dir) return { path: displayKiroFolder(defaultKiroDir(home), home), isDefault: true };
    return { path: displayKiroFolder(dir, await realHome()), isDefault: false };
  }

  async function save(text: string | null): Promise<KiroSettingsResult> {
    let value: string | null = null;
    if (text !== null) {
      const problem = checkKiroFolderText(text);
      if (problem) return { ok: false, error: problem };
      const absolute = expandKiroFolder(text, await realHome());
      if (!absolute) return { ok: false, error: KIRO_FOLDER_MESSAGES.notAbsolute };
      const checked = await check(absolute);
      if ('error' in checked) return { ok: false, error: checked.error };
      // The default folder is stored as null, so that the harness keeps creating it
      const homeReal = await realHome();
      value = checked.real === (await realDefaultDir(homeReal)) ? null : checked.real;
    }
    try {
      await write(value);
    } catch (error) {
      console.warn(
        `[kiro] could not save the settings file: ${error instanceof Error ? error.name : 'error'}`
      );
      return { ok: false, error: 'Could not save the folder. Try again.' };
    }
    stored = Promise.resolve(value);
    return { ok: true, folder: await display(value) };
  }

  return {
    async workspaceDir() {
      const dir = await current();
      if (!dir) return undefined;
      const checked = await check(dir);
      if ('error' in checked || checked.real !== dir) {
        console.warn('[kiro] the folder for new Kiro chats failed its check');
        throw new KiroFolderError(KIRO_FOLDER_UNAVAILABLE);
      }
      return dir;
    },

    async folder() {
      return display(await current());
    },

    set(text) {
      const run = writing.then(() => save(text));
      writing = run.catch(() => undefined);
      return run;
    },
  };
}

let instance: KiroSettings | undefined;

/** The settings of the app's own home folder (one per process) */
export function getKiroSettings(): KiroSettings {
  if (!instance) {
    const environment = defaultKiroEnvironment();
    instance = createKiroSettings({ home: environment.home, platform: environment.platform });
  }
  return instance;
}
