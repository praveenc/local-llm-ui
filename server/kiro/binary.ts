/**
 * Finds the kiro-cli binary on the computer that runs the app.
 *
 * Order: the LOCAL_LLM_UI_KIRO_CLI variable, then ~/.local/bin/kiro-cli, then each folder in PATH.
 * A value in LOCAL_LLM_UI_KIRO_CLI that does not work is an error, never a silent fallback.
 */
import { constants } from 'fs';
import { access, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

export interface KiroEnvironment {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
}

export const defaultKiroEnvironment = (): KiroEnvironment => ({
  env: process.env,
  home: os.homedir(),
  platform: process.platform,
});

const BINARY_NAME = 'kiro-cli';

/** True for an existing regular file (symlinks are followed) that this user can run */
async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveKiroBinary(
  e: KiroEnvironment
): Promise<{ path: string } | { error: string } | null> {
  // The Windows install of Kiro CLI is not supported by this app
  if (e.platform === 'win32') return null;

  const override = e.env.LOCAL_LLM_UI_KIRO_CLI;
  if (override) {
    const expanded = override.startsWith('~/') ? path.join(e.home, override.slice(2)) : override;
    if (path.isAbsolute(expanded) && (await isExecutableFile(expanded))) {
      return { path: expanded };
    }
    return {
      error: `LOCAL_LLM_UI_KIRO_CLI is set to ${override}, which is not an executable file`,
    };
  }

  const local = path.join(e.home, '.local', 'bin', BINARY_NAME);
  if (await isExecutableFile(local)) return { path: local };

  for (const dir of (e.env.PATH ?? '').split(':')) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, BINARY_NAME);
    if (await isExecutableFile(candidate)) return { path: candidate };
  }
  return null;
}

/** The path with the home folder written as `~` (only at a folder boundary) */
export function displayPath(file: string, home: string): string {
  if (!home) return file;
  const base = home.endsWith('/') ? home.slice(0, -1) : home;
  if (file === base) return '~';
  return file.startsWith(`${base}/`) ? `~${file.slice(base.length)}` : file;
}
