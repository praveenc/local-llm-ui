/**
 * POST /api/kiro/sessions and POST /api/kiro/sessions/open (K7, D10, D18, D19).
 *
 * The list comes from Kiro's `session/list`, the transcript from `session/load` with replay. The
 * app reads none of Kiro's files for them. Both routes are POSTs because they can start
 * `kiro-cli acp` (SEC-13).
 *
 * - The list keeps only the id, title, folder name, date, and status of each session. Kiro's
 *   other fields (for example `customAgents`, most of the 14 MB list) are dropped at once. The
 *   browser gets the last part of the folder path only, never the full path. Never-used
 *   sessions ("New Session") are left out. The parsed list is kept for 60 s and dropped when
 *   Kiro reports a change (`_kiro/sessions/changed`, also after each app reply).
 * - Open takes a session id only: it must be in Kiro's list, and the load uses the folder from
 *   that list, never one from the browser. The replay is read only and ends with session/close.
 *   The response is at most KIRO_IMPORT_MAX_BYTES of JSON, with the session's agent and options.
 *   Its `updatedAt` is read after the replay with a session/list of the session's own folder, so
 *   it is the same instant that the chat route reports (K11), not the cached one (up to 60 s
 *   old). When that read fails or takes more than 1 s, the cached value is used.
 * - Open with `ifUpdatedAfter` (K11, the check before a send and on open): the folder comes from
 *   the session's session.json, and the session must be in the list of that folder (a load of an
 *   id that Kiro does not list would make a new session). When Kiro's time there is the same
 *   instant, the answer is `{ unchanged: true, updatedAt }` with no load. Else the replay runs as
 *   above, with no full list. When the folder list says the session is not idle (a turn runs in
 *   the terminal), the answer is 409 with no load. When the folder list fails, takes more than
 *   1 s, or lacks the id, the session must be in the full list (else 404, no load), and the open
 *   works as without `ifUpdatedAfter` with the full list's time: never a wrong `unchanged`.
 *
 * Logs the size and the time only: never titles, folders, or text.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { KIRO_SESSION_ID } from '../../src/utils/kiroChat.ts';
import {
  KIRO_IMPORT_MAX_BYTES,
  KIRO_SESSIONS_MAX,
  KIRO_SESSIONS_TTL_MS,
  folderName,
  isInWindow,
  isNeverUsedSession,
  isSameKiroTime,
  parseKiroSessionOpenRequest,
  parseKiroSessionsRequest,
} from '../../src/utils/kiroSessions.ts';
import type {
  KiroSessionOpenResponse,
  KiroSessionSummary,
  KiroSessionUnchangedResponse,
  KiroSessionsResponse,
} from '../../src/utils/kiroSessions.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { readBodyWithLimit } from '../security.ts';
import { KiroBusyError, KiroSignedOutError } from './agent.ts';
import type { KiroAgent } from './agent.ts';
import { defaultKiroEnvironment } from './binary.ts';
import type { KiroEnvironment } from './binary.ts';
import { kiroSessionOptions } from './chat-options.ts';
import { createKiroReplayCollector } from './replay.ts';
import { findKiroSessionCwd } from './session-files.ts';

export type KiroSessionsAgent = Pick<
  KiroAgent,
  'listSessions' | 'replaySession' | 'onAgentNotification' | 'isBusy'
>;

export interface KiroSessionsHandlerOptions {
  agent: KiroSessionsAgent;
  statusReader: { read(refresh?: boolean): Promise<KiroStatus> };
  ttlMs?: number;
  now?: () => number;
  /** How long an open waits for the session's exact time (K11). Default 1 s. */
  stampWaitMs?: number;
  /** The home folder that holds Kiro's session files. Default: this computer's. */
  environment?: KiroEnvironment;
  /** The folder of a session from its session.json (tests). Default: findKiroSessionCwd. */
  findCwd?: (sessionId: string) => Promise<string | undefined>;
}

/** The parts of a list entry that the app keeps; `cwd` stays on the server */
interface Entry {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: string;
  status: string;
}

const BODY_LIMIT = 1024;
const STAMP_WAIT_MS = 1_000;
export const KIRO_SESSIONS_FAILED =
  'Kiro could not list your sessions. See the terminal that runs npm run dev.';
export const KIRO_SESSION_OPEN_FAILED =
  'Kiro could not open this session. See the terminal that runs npm run dev.';
export const KIRO_SESSION_NOT_FOUND = 'Kiro has no session with this id.';
export const KIRO_SESSION_BUSY =
  'Kiro is answering in this session. Try again when the reply ends.';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Sends the body; returns its size in bytes */
function sendJson(res: ServerResponse, status: number, body: unknown): number {
  const text = JSON.stringify(body);
  const bytes = Buffer.byteLength(text, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', bytes);
  res.end(text);
  return bytes;
}

const SIGN_IN = { error: 'Sign in to Kiro in Preferences → Providers.', code: 'signed-out' };

/** One entry of Kiro's list with only the fields that the app keeps, or undefined */
function toEntry(value: unknown): Entry | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const { sessionId, cwd, title, updatedAt } = raw;
  if (typeof sessionId !== 'string' || !KIRO_SESSION_ID.test(sessionId)) return undefined;
  if (typeof cwd !== 'string' || !cwd || !folderName(cwd)) return undefined;
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return undefined;
  const status = asRecord(asRecord(raw._meta)?.kiro)?.status;
  return {
    sessionId,
    cwd,
    title: typeof title === 'string' ? title : '',
    updatedAt: new Date(updatedAt).toISOString(),
    status: typeof status === 'string' ? status : 'idle',
  };
}

/** The status check of every Kiro route; a reply when Kiro cannot be used */
function statusError(status: KiroStatus): { code: number; error: string } | undefined {
  if (status.state === 'not-installed') return { code: 503, error: 'Kiro CLI is not installed.' };
  if (status.state === 'unsupported') {
    return { code: 503, error: `Kiro CLI ${status.version} is not supported. Install Kiro CLI 3.` };
  }
  if (status.state === 'error') return { code: 503, error: 'Could not check Kiro CLI.' };
  if (status.state !== 'signed-in') {
    return { code: 401, error: 'Sign in to Kiro in Preferences → Providers.' };
  }
  return undefined;
}

const errorName = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';

export function createKiroSessionsHandler(options: KiroSessionsHandlerOptions) {
  const { agent, statusReader } = options;
  const ttlMs = options.ttlMs ?? KIRO_SESSIONS_TTL_MS;
  const now = options.now ?? Date.now;
  const stampWaitMs = options.stampWaitMs ?? STAMP_WAIT_MS;
  const findCwd =
    options.findCwd ??
    ((sessionId: string) =>
      findKiroSessionCwd(sessionId, {
        home: (options.environment ?? defaultKiroEnvironment()).home,
      }));

  let cached: { entries: Entry[]; at: number } | undefined;
  let loading: Promise<Entry[]> | undefined;
  /** Counts the drops: a list that started before a drop is not kept */
  let generation = 0;

  agent.onAgentNotification((method) => {
    if (method !== '_kiro/sessions/changed') return;
    cached = undefined;
    generation += 1;
  });

  /** Kiro's list, parsed and newest first, from the cache when it is fresh */
  function entries(): Promise<Entry[]> {
    if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.entries);
    if (!loading) {
      const started = Date.now();
      const at = generation;
      loading = agent
        .listSessions()
        .then((result) => {
          const parsed = result.sessions
            .map(toEntry)
            .filter((e): e is Entry => !!e && !isNeverUsedSession(e.title))
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
          if (at === generation) cached = { entries: parsed, at: now() };
          console.log(
            `[kiro] session list: ${parsed.length} of ${result.sessions.length} (${Date.now() - started} ms)`
          );
          return parsed;
        })
        .finally(() => {
          loading = undefined;
        });
    }
    return loading;
  }

  /**
   * The session's entry in a list of its own folder (K11): Kiro's time now, the same instant as
   * the chat route's. Null when that list does not have the session; undefined when the list
   * fails or takes longer than the wait. Never rejects.
   */
  async function folderEntry(sessionId: string, cwd: string): Promise<Entry | null | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const read = Promise.resolve()
      .then(() => agent.listSessions({ cwd }))
      .then(
        (result) =>
          result.sessions
            .map(toEntry)
            .find((e): e is Entry => e?.sessionId === sessionId && !isNeverUsedSession(e.title)) ??
          null,
        (error: unknown) => {
          console.warn(
            `[kiro] could not read the session time: ${error instanceof Error ? error.name : 'unknown error'}`
          );
          return undefined;
        }
      );
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), stampWaitMs);
      timer.unref();
    });
    return Promise.race([read, late]).finally(() => clearTimeout(timer));
  }

  /** The session's time now, or the entry's time when the folder list cannot tell */
  async function exactUpdatedAt(entry: Entry): Promise<string> {
    return (await folderEntry(entry.sessionId, entry.cwd))?.updatedAt ?? entry.updatedAt;
  }

  /** The session from Kiro's full list (cached up to 60 s), or undefined */
  async function listedEntry(sessionId: string): Promise<Entry | undefined> {
    let entry = (await entries()).find((e) => e.sessionId === sessionId);
    if (!entry && cached) {
      // A session made after the cached list
      cached = undefined;
      entry = (await entries()).find((e) => e.sessionId === sessionId);
    }
    return entry;
  }

  /** Reads the JSON body; null when a reply was sent */
  async function readJson(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const body = await readBodyWithLimit(req, res, BODY_LIMIT);
    if (body === null) return null;
    if (!body.trim()) return undefined;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      sendJson(res, 400, { error: 'The request body is not valid JSON' });
      return null;
    }
  }

  async function checkStatus(res: ServerResponse): Promise<boolean> {
    const failed = statusError(await statusReader.read());
    if (!failed) return true;
    sendJson(res, failed.code, failed.code === 401 ? SIGN_IN : { error: failed.error });
    return false;
  }

  async function list(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = await readJson(req, res);
    if (json === null) return;
    const parsed = parseKiroSessionsRequest(json);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    if (!(await checkStatus(res))) return;
    try {
      const at = now();
      const sessions: KiroSessionSummary[] = (await entries())
        .filter((e) => isInWindow(e.updatedAt, parsed.value.days, at))
        .slice(0, KIRO_SESSIONS_MAX)
        .map(({ sessionId, title, cwd, updatedAt, status }) => ({
          sessionId,
          title,
          folder: folderName(cwd),
          updatedAt,
          status,
        }));
      const body: KiroSessionsResponse = { sessions };
      sendJson(res, 200, body);
    } catch (error) {
      if (error instanceof KiroSignedOutError) {
        sendJson(res, 401, SIGN_IN);
        return;
      }
      console.warn(`[kiro] session list failed: ${errorName(error)}`);
      sendJson(res, 500, { error: KIRO_SESSIONS_FAILED });
    }
  }

  async function open(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = await readJson(req, res);
    if (json === null) return;
    const parsed = parseKiroSessionOpenRequest(json);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    if (!(await checkStatus(res))) return;
    const { sessionId, skipTurns, ifUpdatedAfter } = parsed.value;
    const started = Date.now();
    try {
      let entry: Entry | undefined;
      // After the replay, read Kiro's time again in the session's folder (B3). Not when that
      // folder list already timed out or lacked the session: the second read would only wait
      // again, so the full list's time is used.
      let readExactTime = true;
      if (ifUpdatedAfter !== undefined) {
        // A reply runs in the session: its time moves, so neither answer would be right
        if (agent.isBusy(sessionId)) throw new KiroBusyError('Kiro is answering in this session');
        const cwd = await findCwd(sessionId);
        if (cwd === undefined) {
          // No session.json: no load of an id that may not be Kiro's
          sendJson(res, 404, { error: KIRO_SESSION_NOT_FOUND });
          return;
        }
        const found = await folderEntry(sessionId, cwd);
        if (found) {
          // A turn runs in the session (in the terminal): a replay now could count half of it
          if (found.status !== 'idle') {
            throw new KiroBusyError('Kiro is answering in this session');
          }
          if (isSameKiroTime(found.updatedAt, ifUpdatedAfter)) {
            const body: KiroSessionUnchangedResponse = {
              unchanged: true,
              updatedAt: found.updatedAt,
            };
            sendJson(res, 200, body);
            console.log(`[kiro] session unchanged (${Date.now() - started} ms)`);
            return;
          }
          entry = found;
        } else {
          // The folder list failed, was slow, or lacks the id (session.json names another form
          // of the folder): the session must still be in Kiro's full list, else 404 with no load
          readExactTime = false;
          entry = await listedEntry(sessionId);
        }
      } else {
        entry = await listedEntry(sessionId);
      }
      if (!entry) {
        sendJson(res, 404, { error: KIRO_SESSION_NOT_FOUND });
        return;
      }
      const collector = createKiroReplayCollector(skipTurns);
      // A config_option_update during the load is newer than the load answer's options
      let latestOptions: unknown;
      const load = await agent.replaySession(sessionId, entry.cwd, (update) => {
        if (update.sessionUpdate === 'config_option_update') {
          const options = (update as { configOptions?: unknown }).configOptions;
          if (Array.isArray(options)) latestOptions = options;
        }
        collector.onUpdate(update);
      });
      // The browser left during the replay: nobody reads the answer
      if (res.destroyed) return;
      // The session's agent and options (K9): their size comes off the size of the turns
      const sessionOptions = kiroSessionOptions(latestOptions ?? load.configOptions);
      const result = collector.finish(
        load,
        KIRO_IMPORT_MAX_BYTES - Buffer.byteLength(JSON.stringify(sessionOptions), 'utf8')
      );
      const title = asRecord(load._meta)?.title;
      const updatedAt = readExactTime ? await exactUpdatedAt(entry) : entry.updatedAt;
      if (res.destroyed) return;
      const body: KiroSessionOpenResponse = {
        title: typeof title === 'string' && title.trim() ? title : entry.title,
        updatedAt,
        ...result,
        sessionOptions,
      };
      const bytes = sendJson(res, 200, body);
      console.log(
        `[kiro] session opened: ${result.turns} turns, ${result.messages.length} messages, ${bytes} bytes (${Date.now() - started} ms)`
      );
    } catch (error) {
      if (error instanceof KiroBusyError) {
        sendJson(res, 409, { error: KIRO_SESSION_BUSY });
        return;
      }
      if (error instanceof KiroSignedOutError) {
        sendJson(res, 401, SIGN_IN);
        return;
      }
      console.warn(`[kiro] session open failed: ${errorName(error)}`);
      sendJson(res, 500, { error: KIRO_SESSION_OPEN_FAILED });
    }
  }

  return { list, open };
}
