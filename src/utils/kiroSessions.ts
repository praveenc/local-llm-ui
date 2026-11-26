/**
 * Kiro sessions in the sidebar (K7, D10, D18, D19): the bodies of POST /api/kiro/sessions and
 * POST /api/kiro/sessions/open, the compact messages of an imported session, and the rules that
 * the server and the browser share. Shared by the browser and the server, so no DOM or Node
 * imports.
 *
 * The list and the transcript come from Kiro (`session/list`, `session/load` with replay). The
 * app does not read Kiro's files for them.
 */
import { KIRO_SESSION_ID } from './kiroChat.ts';
import { parseSessionOptionsSnapshot } from './sessionOptions.ts';
import type { SessionOptionsSnapshot } from './sessionOptions.ts';

/** Kiro's title of a session that was never used (D19) */
export const KIRO_NEW_SESSION_TITLE = 'New Session';
/** The list keeps at most this many sessions, newest first */
export const KIRO_SESSIONS_MAX = 2_000;
/** The server keeps the parsed list this long (ms) */
export const KIRO_SESSIONS_TTL_MS = 60_000;
/**
 * `skipTurns` for a count-only open (K11): the open route then maps no turn and answers with no
 * messages, only Kiro's turn count, time, and options (`server/kiro/replay.ts` counts the turns
 * before `skipTurns` without mapping them)
 */
export const KIRO_COUNT_ONLY_SKIP = Number.MAX_SAFE_INTEGER;

/** The import response is at most this many bytes of JSON: older turns are left out first */
export const KIRO_IMPORT_MAX_BYTES = 16 * 1024 * 1024;
/** Tool output is cut to this size, as `toolResults.ts` stores it */
export const KIRO_IMPORT_TOOL_OUTPUT = 8_000;
/** Each string in a tool call's arguments is cut to this size */
export const KIRO_IMPORT_ARG_CHARS = 2_000;
/** The text of one message and the thinking of one reply are cut to these sizes */
export const KIRO_IMPORT_TEXT_CHARS = 400_000;
export const KIRO_IMPORT_REASONING_CHARS = 100_000;

/** The windows of the section's menu: Last 7 days (default), Last 30 days, All (null) */
export type KiroSessionWindow = 7 | 30 | null;
export const KIRO_SESSION_WINDOWS: readonly KiroSessionWindow[] = [7, 30, null];
export const DEFAULT_KIRO_SESSION_WINDOW: KiroSessionWindow = 7;

// --- POST /api/kiro/sessions ---

export interface KiroSessionsRequest {
  days: KiroSessionWindow;
}

/** One session of the list. No full path: `folder` is the last part of the session folder. */
export interface KiroSessionSummary {
  sessionId: string;
  title: string;
  folder: string;
  /** Kiro's last change, ISO 8601 */
  updatedAt: string;
  /** Kiro's own status word, for example "idle", "in_progress", or "failed" */
  status: string;
}

export interface KiroSessionsResponse {
  sessions: KiroSessionSummary[];
}

// --- POST /api/kiro/sessions/open ---

export interface KiroSessionOpenRequest {
  sessionId: string;
  /**
   * The turns of the session that the conversation already holds: the response has only the
   * turns after them. 0 for a new import.
   */
  skipTurns: number;
}

/** A tool call of an imported reply. Same shape as a stored tool call (`StoredToolCall`). */
export interface KiroImportedToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'complete' | 'error';
  /** The output (complete) or the error text (error), cut to KIRO_IMPORT_TOOL_OUTPUT */
  result?: string;
}

/** One message of an imported session. A turn gives one user and one assistant message. */
export interface KiroImportedMessage {
  role: 'user' | 'assistant';
  /** User: the text without the app's `<conversation_context>` block. Assistant: the answer. */
  content: string;
  /** Assistant: the thinking text */
  reasoning?: string;
  toolCalls?: KiroImportedToolCall[];
  /** Assistant: Kiro's credits of the turn */
  credits?: number;
  /** Assistant: how full the context window was after the turn, 0 to 100 */
  contextPercent?: number;
  /** Assistant: Kiro's time of the turn */
  latencyMs?: number;
}

export interface KiroSessionOpenResponse {
  title: string;
  /** Kiro's last change from the list, ISO 8601: stored as `kiro.updatedAt` */
  updatedAt: string;
  /** The session's model from its config options */
  model?: { id: string; name: string };
  /** The session's agent and other options from the load answer (K9) */
  sessionOptions?: SessionOptionsSnapshot;
  /** The turns after `skipTurns`, oldest first */
  messages: KiroImportedMessage[];
  /** All turns of the session in Kiro: stored as `kiro.turns` */
  turns: number;
  /** Images in user messages that the app left out */
  imagesLeftOut: number;
  /** Older turns that the app left out to keep the response under KIRO_IMPORT_MAX_BYTES */
  turnsLeftOut: number;
}

/** What a conversation stores of its Kiro session for a later sync (in `Conversation.kiro`) */
export interface KiroSessionSync {
  /** Kiro's `updatedAt` at the last import or sync */
  updatedAt?: string;
  /**
   * How many Kiro turns the conversation holds. Absent: unknown (a chat made before K7, or a reply
   * in a chat that Kiro's time did not show to hold every turn, K11): the next open counts the
   * turns again and adds no messages.
   */
  turns?: number;
}

// --- parsing ---

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Checks the body of POST /api/kiro/sessions. An empty body or `{}` is the default window. */
export function parseKiroSessionsRequest(value: unknown): Parsed<KiroSessionsRequest> {
  if (value === undefined) return { ok: true, value: { days: DEFAULT_KIRO_SESSION_WINDOW } };
  if (!isRecord(value)) return { ok: false, error: 'Send the request as a JSON object' };
  if (value.days === undefined) {
    return { ok: true, value: { days: DEFAULT_KIRO_SESSION_WINDOW } };
  }
  if (!KIRO_SESSION_WINDOWS.includes(value.days as KiroSessionWindow)) {
    return { ok: false, error: 'days must be 7, 30, or null' };
  }
  return { ok: true, value: { days: value.days as KiroSessionWindow } };
}

/** Checks the body of POST /api/kiro/sessions/open */
export function parseKiroSessionOpenRequest(value: unknown): Parsed<KiroSessionOpenRequest> {
  if (!isRecord(value)) return { ok: false, error: 'Send the request as a JSON object' };
  if (typeof value.sessionId !== 'string' || !KIRO_SESSION_ID.test(value.sessionId)) {
    return { ok: false, error: 'The Kiro session id is not valid' };
  }
  const skip = value.skipTurns ?? 0;
  if (!isCount(skip)) return { ok: false, error: 'skipTurns must be a whole number' };
  return { ok: true, value: { sessionId: value.sessionId, skipTurns: skip } };
}

function parseSummary(value: unknown): KiroSessionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { sessionId, title, folder, updatedAt, status } = value;
  if (typeof sessionId !== 'string' || !KIRO_SESSION_ID.test(sessionId)) return undefined;
  if (typeof title !== 'string' || typeof folder !== 'string') return undefined;
  if (!isIsoDate(updatedAt) || typeof status !== 'string') return undefined;
  return { sessionId, title, folder, updatedAt, status };
}

/** The browser's check of the list response. Bad entries are dropped; a bad body is null. */
export function parseKiroSessionsResponse(value: unknown): KiroSessionSummary[] | null {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return null;
  return value.sessions.map(parseSummary).filter((s): s is KiroSessionSummary => !!s);
}

function parseToolCall(value: unknown): KiroImportedToolCall | undefined {
  if (!isRecord(value)) return undefined;
  const { toolCallId, toolName, args, status, result } = value;
  if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return undefined;
  if (status !== 'complete' && status !== 'error') return undefined;
  if (result !== undefined && typeof result !== 'string') return undefined;
  return {
    toolCallId,
    toolName,
    args: isRecord(args) ? args : {},
    status,
    ...(result !== undefined && { result }),
  };
}

function parseMessage(value: unknown): KiroImportedMessage | undefined {
  if (!isRecord(value)) return undefined;
  const { role, content, reasoning, toolCalls, credits, contextPercent, latencyMs } = value;
  if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return undefined;
  const tools = Array.isArray(toolCalls)
    ? toolCalls.map(parseToolCall).filter((t): t is KiroImportedToolCall => !!t)
    : [];
  return {
    role,
    content,
    ...(typeof reasoning === 'string' && reasoning && { reasoning }),
    ...(tools.length > 0 && { toolCalls: tools }),
    ...(isAmount(credits) && { credits }),
    ...(isAmount(contextPercent) && { contextPercent }),
    ...(isAmount(latencyMs) && { latencyMs }),
  };
}

/** The browser's check of the open response; null when it is not one */
export function parseKiroSessionOpenResponse(value: unknown): KiroSessionOpenResponse | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  const { title, updatedAt, model, turns, imagesLeftOut, turnsLeftOut } = value;
  // A bad snapshot is left out: the import still works without the options
  const sessionOptions =
    value.sessionOptions === undefined ? null : parseSessionOptionsSnapshot(value.sessionOptions);
  if (typeof title !== 'string' || !isIsoDate(updatedAt)) return null;
  if (!isCount(turns) || !isCount(imagesLeftOut) || !isCount(turnsLeftOut)) return null;
  const messages: KiroImportedMessage[] = [];
  for (const entry of value.messages) {
    const message = parseMessage(entry);
    if (!message) return null;
    messages.push(message);
  }
  const validModel =
    isRecord(model) && typeof model.id === 'string' && typeof model.name === 'string'
      ? { id: model.id, name: model.name }
      : undefined;
  return {
    title,
    updatedAt,
    ...(validModel && { model: validModel }),
    ...(sessionOptions && { sessionOptions }),
    messages,
    turns,
    imagesLeftOut,
    turnsLeftOut,
  };
}

// --- rules ---

/** The last part of a folder path, for the row. The full path never goes to the browser. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** A session that was never used: Kiro's title before the first prompt (D19) */
export function isNeverUsedSession(title: string | undefined): boolean {
  return !title || title.trim() === KIRO_NEW_SESSION_TITLE;
}

/** True when `updatedAt` is in the last `days` days (always true for All) */
export function isInWindow(updatedAt: string, days: KiroSessionWindow, now = Date.now()): boolean {
  if (days === null) return true;
  return Date.parse(updatedAt) >= now - days * 24 * 60 * 60 * 1000;
}

/**
 * Kiro's time of the session in two events of the chat route (K11), both an ISO time from Kiro's
 * session/list, the same value that the sessions routes report:
 * - `{ sessionUpdatedBefore: string }` right after the `session` event of a known session: the
 *   time before this message. Left out when the server could not read it within 1 s.
 * - `{ sessionUpdatedAt: string }` before `metadata`: the time after the turn, also for a new
 *   session. Left out for a cancelled reply, or when the server could not read it.
 * Returns the time, or undefined when the value is not a date.
 */
export function parseKiroSessionStamp(value: unknown): string | undefined {
  return isIsoDate(value) ? value : undefined;
}

/**
 * True when the chat held every turn of its session before this message (K11): the record counts
 * turns, has Kiro's time of its last sync, and Kiro's time before the message (the
 * `sessionUpdatedBefore` event) is the same instant. Any turn or option change since then, also
 * in the terminal, moves Kiro's time. Compared as instants (`Date.parse`), so that two ISO forms of
 * the same time match.
 */
export function isKiroChatInSync(
  sync: KiroSessionSync | undefined,
  before: string | undefined
): boolean {
  if (sync?.turns === undefined || !sync.updatedAt || !before) return false;
  const stored = Date.parse(sync.updatedAt);
  return !Number.isNaN(stored) && stored === Date.parse(before);
}

/** True when Kiro changed the session after the conversation's last import or sync */
export function isNewerInKiro(listUpdatedAt: string, sync: KiroSessionSync | undefined): boolean {
  if (!sync?.updatedAt) return true;
  return Date.parse(listUpdatedAt) > Date.parse(sync.updatedAt);
}

const CONTEXT_BLOCK = /^<conversation_context>\n[\s\S]*?\n<\/conversation_context>\n\n/;

/**
 * The user's own text of a prompt that the app sent: without the `<conversation_context>` block
 * of `buildKiroPrompt`. A closing tag inside the block is escaped, so the first one ends it.
 */
export function stripKiroContext(text: string): string {
  return text.replace(CONTEXT_BLOCK, '');
}

const cutText = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** The tool call's arguments with each string cut to KIRO_IMPORT_ARG_CHARS (also nested) */
export function cutToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const cut = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return cutText(value, KIRO_IMPORT_ARG_CHARS);
    if (depth > 4 || !value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 100).map((v) => cut(v, depth + 1));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cut(v, depth + 1)])
    );
  };
  return cut(args, 0) as Record<string, unknown>;
}

/** Messages with text: the ones that the chat sends as history, so `seenMessages` counts them */
export function countTextMessages(messages: readonly { content: string }[]): number {
  return messages.filter((m) => m.content.trim().length > 0).length;
}

/**
 * `seenMessages` after a sync added `added` messages at the end of a chat that had
 * `textMessages` messages with text. When Kiro had seen the whole chat, it has seen the added
 * turns too. When the chat also has messages that Kiro has not seen (app-only replies of other
 * models), the count stays: the next prompt then sends those messages and the added turns once
 * as context, so nothing is lost.
 */
export function seenAfterSync(
  seenMessages: number,
  textMessages: number,
  added: readonly { content: string }[]
): number {
  return seenMessages === textMessages ? seenMessages + countTextMessages(added) : seenMessages;
}
