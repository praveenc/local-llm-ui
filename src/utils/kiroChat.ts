/**
 * Kiro chat: the body of POST /api/kiro/chat, the SSE events that only Kiro sends, and the
 * context block for messages that Kiro has not seen (D12). Shared by the browser and the server,
 * so no DOM or Node imports.
 *
 * A Kiro session keeps its own history, so the app does not send the whole chat as messages.
 * It sends the new message, the earlier messages, and how many of those Kiro has seen. The server
 * puts the ones that Kiro has not seen in front of the new message, once.
 */
import { type ThinkingEffort, isThinkingEffort } from './thinkingEffort.ts';

/** A Kiro session id: sess_ and a UUID */
export const KIRO_SESSION_ID =
  /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const MAX_PROMPT_CHARS = 200_000;
const MAX_HISTORY_MESSAGES = 2_000;
/** The context block keeps the newest messages up to this size, about 100K tokens */
export const MAX_CONTEXT_CHARS = 400_000;

export interface KiroHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface KiroChatRequest {
  /** The chat's Kiro session. Absent for a chat that has none yet. */
  sessionId?: string;
  /** How many of `history` the session has seen, from the start */
  seenMessages: number;
  /** All earlier messages of the chat, oldest first, without the new one */
  history: KiroHistoryMessage[];
  /** The new message */
  prompt: string;
  /** A Kiro model id */
  model: string;
  thinkingEffort?: ThinkingEffort;
}

/**
 * SSE events that only the Kiro route sends. It also sends the shared ones: `content`,
 * `reasoning`, `toolCall`, `toolResult`, `metadata` (with `usage.credits`, `usage.contextPercent`,
 * and `latencyMs`), `error`, and `[DONE]`.
 */
export type KiroChatEvent =
  /** First: the session that this reply uses. `created` is true for a new session. */
  | { session: { id: string; created: boolean } }
  /** Progress before the first output, for example "Starting Kiro…" */
  | { status: string }
  /** Kiro's short title for the chat */
  | { title: string };

/** Shown on a tool call that the app denied, until the approval UI (K6) */
export const KIRO_DENIED_TOOL = 'Denied: approvals come in a later version';

/** Notices for a reply that ended for a reason other than end_turn or cancelled */
export const KIRO_STOP_NOTICES: Readonly<Record<string, string>> = {
  max_tokens: 'Kiro stopped the reply at its output limit.',
  max_turn_requests: 'Kiro stopped after too many steps in one reply.',
  refusal: 'Kiro did not answer this message.',
};

type Parsed = { ok: true; value: KiroChatRequest } | { ok: false; error: string };

/** Checks the body of POST /api/kiro/chat */
export function parseKiroChatRequest(value: unknown): Parsed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Send the chat request as a JSON object' };
  }
  const body = value as Record<string, unknown>;

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return { ok: false, error: 'The message is empty' };
  }
  if (body.prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, error: 'The message is too long' };
  }
  if (typeof body.model !== 'string' || !MODEL_ID.test(body.model)) {
    return { ok: false, error: 'Select a Kiro model' };
  }
  if (
    body.sessionId !== undefined &&
    (typeof body.sessionId !== 'string' || !KIRO_SESSION_ID.test(body.sessionId))
  ) {
    return { ok: false, error: 'The Kiro session id is not valid' };
  }
  if (!Array.isArray(body.history) || body.history.length > MAX_HISTORY_MESSAGES) {
    return { ok: false, error: 'The chat history is not valid' };
  }
  const history: KiroHistoryMessage[] = [];
  for (const entry of body.history as unknown[]) {
    const message = entry as Record<string, unknown> | null;
    if (
      !message ||
      typeof message !== 'object' ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string'
    ) {
      return { ok: false, error: 'The chat history is not valid' };
    }
    history.push({ role: message.role, content: message.content });
  }
  const seen = body.seenMessages;
  if (typeof seen !== 'number' || !Number.isInteger(seen) || seen < 0) {
    return { ok: false, error: 'seenMessages must be a whole number' };
  }
  if (body.thinkingEffort !== undefined && !isThinkingEffort(body.thinkingEffort)) {
    return { ok: false, error: 'The thinking effort is not valid' };
  }

  return {
    ok: true,
    value: {
      ...(body.sessionId !== undefined && { sessionId: body.sessionId as string }),
      seenMessages: seen,
      history,
      prompt: body.prompt,
      model: body.model,
      ...(body.thinkingEffort !== undefined && {
        thinkingEffort: body.thinkingEffort as ThinkingEffort,
      }),
    },
  };
}

/**
 * The messages that the session has not seen. A new session has seen none. When the chat has
 * fewer messages than the session saw (a regenerate or a delete changed the chat), the caller
 * must start a new session: see `kiroSessionIsStale`.
 */
export function unseenMessages(
  history: KiroHistoryMessage[],
  seenMessages: number,
  newSession: boolean
): KiroHistoryMessage[] {
  if (newSession) return history;
  return history.slice(Math.min(seenMessages, history.length));
}

/** The chat lost messages that the session has seen, so the session no longer matches it */
export function kiroSessionIsStale(request: Pick<KiroChatRequest, 'history' | 'seenMessages'>) {
  return request.seenMessages > request.history.length;
}

/** Keeps a closing tag in a message from ending the block early */
const escapeTags = (text: string) =>
  text.replace(/<\/(conversation_context|message)>/gi, '<\\/$1>');

/**
 * The prompt text for Kiro: a context block with the unseen messages, then the new message.
 * Without unseen messages, the new message alone. The block keeps the newest messages that fit
 * in MAX_CONTEXT_CHARS and says how many it left out.
 */
export function buildKiroPrompt(unseen: KiroHistoryMessage[], prompt: string): string {
  const messages = unseen.filter((m) => m.content.trim());
  if (messages.length === 0) return prompt;

  const kept: string[] = [];
  let size = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = `<message role="${messages[i].role}">\n${escapeTags(messages[i].content)}\n</message>`;
    if (size + entry.length > MAX_CONTEXT_CHARS && kept.length > 0) break;
    kept.unshift(entry);
    size += entry.length;
  }
  const left = messages.length - kept.length;
  const header = [
    'These messages came earlier in this chat, before you joined it or while another model',
    'answered. Use them as context. Do not answer them again.',
    ...(left > 0
      ? [`(${left} older ${left === 1 ? 'message is' : 'messages are'} left out.)`]
      : []),
  ].join(' ');
  return `<conversation_context>\n${header}\n\n${kept.join('\n\n')}\n</conversation_context>\n\n${prompt}`;
}
