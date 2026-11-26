/**
 * The folder for new Kiro chats (D6, SEC-21): the body and the response of
 * POST /api/kiro/settings, the `folder` field of GET /api/kiro/status, and the checks of a folder
 * path that do not need the disk. Shared by the browser and the server, so no DOM or Node imports.
 *
 * The folder is a server setting, never a field of the chat request (SEC-16). The server stores
 * the real path in `~/.local-llm-ui/kiro-settings.json`. The browser repeats only the text checks
 * (`checkKiroFolderText`) to show a message early; the server makes every check again, with the
 * disk (exists, a folder, owned by the user, writable) and with the real path.
 */
import type { KiroStatus } from './kiroStatus.ts';

/** The largest body of POST /api/kiro/settings, in bytes */
export const KIRO_SETTINGS_BODY_LIMIT = 4 * 1024;
/** The longest folder path that the app accepts, in characters */
export const MAX_KIRO_FOLDER_CHARS = 1024;

/** The folder for new Kiro chats, for display */
export interface KiroFolderSetting {
  /** The real path, with the home folder written as `~` (`~/projects/demo`) */
  path: string;
  /** True when no folder is stored: new chats use `~/.local-llm-ui/kiro` */
  isDefault: boolean;
}

/** The body of POST /api/kiro/settings. `null` goes back to the default folder. */
export interface KiroSettingsRequest {
  workspaceDir: string | null;
}

/** The 200 response of POST /api/kiro/settings. A 400 response is `{ error }` with a message. */
export interface KiroSettingsResponse {
  folder: KiroFolderSetting;
}

/** What GET /api/kiro/status returns: the status, and the folder when the server can tell */
export type KiroStatusResponse = KiroStatus & { folder?: KiroFolderSetting };

/** The content of `~/.local-llm-ui/kiro-settings.json`. `null` or no file: the default folder. */
export interface KiroSettingsFile {
  workspaceDir: string | null;
}

/** The messages of the folder checks. The browser shows them after "Not saved." */
export const KIRO_FOLDER_MESSAGES = {
  notText: 'Send the folder as text, or null for the default folder.',
  empty: 'Write the path of a folder, or use the default.',
  tooLong: `The path is too long. Use at most ${MAX_KIRO_FOLDER_CHARS} characters.`,
  badCharacters: 'The path has characters that are not allowed.',
  notAbsolute: 'Write the full path of a folder, for example ~/projects/demo.',
  notFound: 'This folder does not exist.',
  notFolder: 'This is not a folder.',
  notOwned: 'Choose a folder that you own.',
  notWritable: 'You cannot write to this folder. Choose a different folder.',
  home: 'Kiro cannot use your home folder itself. Choose a folder inside it.',
  system: 'Kiro cannot use a system folder.',
  settings: 'Choose a folder outside your settings folders.',
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Control, format (bidi and zero-width), and line or paragraph separator characters */
const BAD_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Folders that Kiro may never use, and nothing inside them (Linux and macOS) */
export const KIRO_SYSTEM_FOLDERS: readonly string[] = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib32',
  '/lib64',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/run',
  '/var',
  '/snap',
];
/** More system folders on macOS */
export const KIRO_MACOS_SYSTEM_FOLDERS: readonly string[] = [
  '/System',
  '/Library',
  '/private',
  '/Applications',
  '/Volumes',
];
/** Folders in the home folder that hold settings or secrets */
export const KIRO_SETTINGS_FOLDERS: readonly string[] = [
  '.kiro',
  '.aws',
  '.ssh',
  '.config',
  '.local-llm-ui',
];

/** The folder of the app's own settings in the home folder */
const APP_FOLDER = '.local-llm-ui';

/** True when `child` is `parent` or a path inside it (both absolute and normalized) */
export function isInsideFolder(child: string, parent: string): boolean {
  if (parent === '/') return child.startsWith('/');
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * The body of POST /api/kiro/settings: an object with `workspaceDir`, a string or null. Other
 * keys are ignored. The string gets the text checks; the server then checks the disk.
 */
export function parseKiroSettingsRequest(value: unknown): Parsed<KiroSettingsRequest> {
  if (!isRecord(value) || !('workspaceDir' in value)) {
    return { ok: false, error: KIRO_FOLDER_MESSAGES.notText };
  }
  const { workspaceDir } = value;
  if (workspaceDir === null) return { ok: true, value: { workspaceDir: null } };
  if (typeof workspaceDir !== 'string') return { ok: false, error: KIRO_FOLDER_MESSAGES.notText };
  const problem = checkKiroFolderText(workspaceDir);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { workspaceDir: workspaceDir.trim() } };
}

/**
 * The checks of a typed folder that need no disk and no home folder: not empty, at most
 * MAX_KIRO_FOLDER_CHARS characters, no bad characters, an absolute path or one that starts with
 * `~/`. `~` alone is the home folder. An absolute path in a system folder is refused here too,
 * so that the browser shows the message early. Undefined when the text passes.
 */
export function checkKiroFolderText(text: string): string | undefined {
  const value = text.trim();
  if (!value) return KIRO_FOLDER_MESSAGES.empty;
  if (value.length > MAX_KIRO_FOLDER_CHARS) return KIRO_FOLDER_MESSAGES.tooLong;
  if (BAD_CHARACTERS.test(value)) return KIRO_FOLDER_MESSAGES.badCharacters;
  if (value === '~' || value === '~/') return KIRO_FOLDER_MESSAGES.home;
  if (!value.startsWith('/') && !value.startsWith('~/')) return KIRO_FOLDER_MESSAGES.notAbsolute;
  if (value.startsWith('/')) {
    const normal = normalizeAbsolutePath(value);
    if (normal === '/') return KIRO_FOLDER_MESSAGES.system;
    // Without the home folder, only the Linux list is safe to check here: a macOS home is in
    // /Users, and some Linux homes are in /var/home (the server checks those cases)
    if (KIRO_SYSTEM_FOLDERS.some((f) => f !== '/var' && isInsideFolder(normal, f))) {
      return KIRO_FOLDER_MESSAGES.system;
    }
  }
  return undefined;
}

/** A POSIX absolute path with `.`, `..`, and repeated or trailing slashes removed */
export function normalizeAbsolutePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/**
 * The absolute path of a typed folder that passed `checkKiroFolderText`: `~/` becomes the home
 * folder, and the path is normalized. Undefined when the text is not an absolute path.
 */
export function expandKiroFolder(text: string, home: string): string | undefined {
  const value = text.trim();
  if (value.startsWith('~/')) return normalizeAbsolutePath(`${home}/${value.slice(2)}`);
  if (value.startsWith('/')) return normalizeAbsolutePath(value);
  return undefined;
}

export interface KiroFolderPlaces {
  /** The real path of the home folder */
  home: string;
  /** `process.platform`: `darwin` adds the macOS system folders */
  platform: string;
  /** The real path of the app's default Kiro folder (`~/.local-llm-ui/kiro`) */
  defaultDir: string;
  /**
   * The real paths of the settings folders of the home folder (`~/.kiro`, `~/.aws`, `~/.ssh`,
   * `~/.config`). A settings folder can be a symlink, so its real path can be outside the literal
   * path. These are always checked, also for the default Kiro folder.
   */
  settingsDirs?: readonly string[];
  /**
   * The real path of `~/.local-llm-ui`, when it is a symlink. Only the default Kiro folder and
   * the folders inside it are exempt from this rule; the other rules still apply to them.
   */
  appDirs?: readonly string[];
}

/**
 * The place rules for the real path of a folder (after `realpath`): not `/`, not the home folder,
 * not inside a settings folder of the home folder and not a folder that holds one (the default
 * Kiro folder and folders inside it are exempt only from the `~/.local-llm-ui` rule), and not
 * inside a system folder. A folder inside the home folder skips the system list, because a home
 * folder can itself be in `/var/home` or `/private`. Undefined when the folder may be used. The
 * disk checks (a folder, owner, writable) are the server's.
 */
export function kiroFolderPlaceProblem(
  realPath: string,
  places: KiroFolderPlaces
): string | undefined {
  const { home, platform, defaultDir, settingsDirs = [], appDirs = [] } = places;
  if (realPath === '/') return KIRO_FOLDER_MESSAGES.system;
  if (realPath === home) return KIRO_FOLDER_MESSAGES.home;
  // A folder that holds the home folder (for example /home) is not the user's either; the owner
  // check usually refuses it, and this rule refuses it when it does not
  if (isInsideFolder(home, realPath)) return KIRO_FOLDER_MESSAGES.home;
  // Inside a settings folder, or a folder that holds one (a symlinked settings folder can be
  // anywhere, and a folder that holds it would let Kiro's tools reach it). This check always
  // runs, also for the default Kiro folder: that folder can be a symlink to anywhere.
  const settings = [
    ...KIRO_SETTINGS_FOLDERS.filter((name) => name !== APP_FOLDER).map((name) => `${home}/${name}`),
    ...settingsDirs,
  ];
  // The default Kiro folder, and folders inside it, are exempt from the `~/.local-llm-ui` rule only
  if (!isInsideFolder(realPath, defaultDir)) settings.push(`${home}/${APP_FOLDER}`, ...appDirs);
  if (settings.some((dir) => isInsideFolder(realPath, dir) || isInsideFolder(dir, realPath))) {
    return KIRO_FOLDER_MESSAGES.settings;
  }
  if (isInsideFolder(realPath, home)) return undefined;
  const system =
    platform === 'darwin'
      ? [...KIRO_SYSTEM_FOLDERS, ...KIRO_MACOS_SYSTEM_FOLDERS]
      : KIRO_SYSTEM_FOLDERS;
  return system.some((f) => isInsideFolder(realPath, f)) ? KIRO_FOLDER_MESSAGES.system : undefined;
}

/** A path with the home folder written as `~` */
export function displayKiroFolder(file: string, home: string): string {
  if (!home) return file;
  const base = home.endsWith('/') ? home.slice(0, -1) : home;
  if (file === base) return '~';
  return file.startsWith(`${base}/`) ? `~${file.slice(base.length)}` : file;
}

/** The settings file's content, or undefined when it is not valid (the server then uses the default) */
export function parseKiroSettingsFile(value: unknown): KiroSettingsFile | undefined {
  if (!isRecord(value)) return undefined;
  const { workspaceDir } = value;
  if (workspaceDir === null || workspaceDir === undefined) return { workspaceDir: null };
  if (
    typeof workspaceDir !== 'string' ||
    workspaceDir.length > MAX_KIRO_FOLDER_CHARS ||
    BAD_CHARACTERS.test(workspaceDir) ||
    !workspaceDir.startsWith('/') ||
    normalizeAbsolutePath(workspaceDir) !== workspaceDir
  ) {
    return undefined;
  }
  return { workspaceDir };
}
