/**
 * The folder of a Kiro session, read from Kiro's own files on disk.
 *
 * Kiro keeps each session in `~/.kiro/sessions/<bucket>/<sessionId>/session.json`. The bucket is
 * the first 16 hex characters of the SHA-256 of the session folder path. The chat route uses this
 * to open an existing session in its own folder: the folder never comes from the browser.
 */
import { createHash } from 'crypto';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

import { KIRO_SESSION_ID } from '../../src/utils/kiroChat.ts';

const BUCKET = /^[0-9a-f]{16}$/;
/** session.json is small; a larger file (in bytes) is not one that Kiro wrote */
const MAX_SESSION_FILE = 1024 * 1024;

const bucketOf = (cwd: string) => createHash('sha256').update(cwd).digest('hex').slice(0, 16);

function firstPath(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first: unknown = value[0];
  return typeof first === 'string' && path.isAbsolute(first) ? first : undefined;
}

async function readSessionCwd(file: string, sessionId: string, bucket: string) {
  let text: string;
  try {
    // Check the size in bytes before the file is read
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_SESSION_FILE) return undefined;
    text = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const session = json as Record<string, unknown>;
  if (session.id !== sessionId) return undefined;
  const cwd = firstPath(session.workspacePaths) ?? firstPath(session.rootPaths);
  if (!cwd || bucketOf(cwd) !== bucket) return undefined;
  return cwd;
}

/**
 * The folder of the session `sessionId`, or undefined when Kiro has no valid session.json for it.
 * The folder must hash to the bucket that holds the file, and the file must name the same id.
 */
export async function findKiroSessionCwd(
  sessionId: string,
  { home }: { home: string }
): Promise<string | undefined> {
  if (!KIRO_SESSION_ID.test(sessionId)) return undefined;
  const root = path.join(home, '.kiro', 'sessions');
  let buckets: string[];
  try {
    buckets = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && BUCKET.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const bucket of buckets) {
    const cwd = await readSessionCwd(
      path.join(root, bucket, sessionId, 'session.json'),
      sessionId,
      bucket
    );
    if (cwd) return cwd;
  }
  return undefined;
}
