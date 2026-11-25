/**
 * Kiro's own fields of one reply, from `_meta.kiro` of session_info_update: the title, the
 * context fill, a display_error, and the credits and time of turn_completion. Also the name of
 * a Kiro tool call.
 */
import type { SessionUpdate, ToolCallUpdate } from '../acp/types.ts';

/** An MCP tool's title is `@server/tool` */
const MCP_TITLE = /^@\S/;
/** The tool id at the start of Kiro's toolCallId: `run_command_toolu_bdrk_01…` */
const TOOL_ID = /^([a-z][a-z0-9_]*?)_tool(?:u|use)_/;
/** A display_error notice is cut to this size */
const MAX_DISPLAY_ERROR = 300;

/** Lower case, single spaces, no punctuation at the end: to compare a title with the prompt */
const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?:;,…]+$/u, '');

/**
 * Kiro's first focus_update title is the start of the prompt itself, before Kiro makes a short
 * title. That one is not sent: the app's own title from the first message is the same text.
 */
export function isPromptEcho(title: string, prompt: string): boolean {
  const t = comparable(title);
  return t.length > 0 && comparable(prompt).startsWith(t);
}

/** The name that the work row shows for a Kiro tool call */
export function kiroToolName(update: Pick<ToolCallUpdate, 'toolCallId' | 'title' | 'kind'>) {
  if (typeof update.title === 'string' && MCP_TITLE.test(update.title)) return update.title;
  const id = typeof update.toolCallId === 'string' ? TOOL_ID.exec(update.toolCallId)?.[1] : '';
  if (id) return id;
  if (typeof update.kind === 'string' && update.kind) return update.kind;
  return 'tool';
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export interface KiroReplyMeta {
  /** For each update that the update mapper does not handle */
  onUpdate(update: SessionUpdate): void;
  readonly credits: number | undefined;
  readonly contextPercent: number | undefined;
  readonly elapsedMs: number | undefined;
  /** The last display_error that is not an MCP connection error */
  readonly displayError: string | undefined;
}

export function createKiroReplyMeta(input: {
  /** The user's new message, to skip a title that only repeats it */
  prompt: string;
  /** The session's title before this reply */
  title: string | undefined;
  send(event: { title: string }): void;
}): KiroReplyMeta {
  let title = input.title;
  let credits: number | undefined;
  let contextPercent: number | undefined;
  let elapsedMs: number | undefined;
  let displayError: string | undefined;

  const onUpdate = (update: SessionUpdate) => {
    // available_commands_update, config_option_update, _kiro/*: nothing to do
    if (update.sessionUpdate !== 'session_info_update') return;
    const kiro = asRecord(asRecord(update._meta)?.kiro);
    if (!kiro) return;
    if (kiro.kind === 'focus_update') {
      const next = typeof kiro.title === 'string' ? kiro.title : update.title;
      if (typeof next === 'string' && next && next !== title) {
        title = next;
        if (!isPromptEcho(next, input.prompt)) input.send({ title: next });
      }
    } else if (kiro.kind === 'context_usage' || (kiro.kind === undefined && kiro.contextUsage)) {
      contextPercent =
        asNumber(kiro.usagePercentage) ??
        asNumber(asRecord(kiro.contextUsage)?.usagePercentage) ??
        contextPercent;
    } else if (kiro.kind === 'display_error') {
      // MCP connection errors come on many normal replies
      const detail = asRecord(kiro.displayError);
      const type = kiro.errorType ?? detail?.errorType;
      const message = kiro.message ?? detail?.message;
      if (type !== 'mcp_connection_error' && typeof message === 'string' && message.trim()) {
        displayError = message.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_ERROR);
      }
    } else if (kiro.kind === 'turn_completion') {
      for (const summary of Array.isArray(kiro.promptTurnSummaries)
        ? kiro.promptTurnSummaries
        : []) {
        const usage = asNumber(asRecord(summary)?.usage);
        if (asRecord(summary)?.unit === 'credit' && usage !== undefined) {
          credits = (credits ?? 0) + usage;
        }
      }
      elapsedMs = asNumber(kiro.elapsedTime) ?? elapsedMs;
    }
  };

  return {
    onUpdate,
    get credits() {
      return credits;
    },
    get contextPercent() {
      return contextPercent;
    },
    get elapsedMs() {
      return elapsedMs;
    },
    get displayError() {
      return displayError;
    },
  };
}
