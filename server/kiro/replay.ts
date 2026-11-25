/**
 * Turns Kiro's replay of a session (session/load without `noReplay`) into the compact messages
 * of an import (K7): one user and one assistant message per turn.
 *
 * Kiro marks each replayed update with `_meta.kiro.replay: true`; other updates (the ones after
 * the load answer) are not part of the history and are skipped. A turn starts at a user message
 * with a new `messageId`, or at a `turn_start` when the turn has started already. The assistant
 * side goes through the same update mapper and reply meta as a live reply, so tool calls, their
 * status and output, the credits, the context fill, and the time read the same. Kiro's approval
 * rows are not shown: Kiro already asked them (D15).
 *
 * The collector keeps only the compact turns, never the raw updates. Nothing is logged.
 */
import {
  KIRO_IMPORT_MAX_BYTES,
  KIRO_IMPORT_REASONING_CHARS,
  KIRO_IMPORT_TEXT_CHARS,
  KIRO_IMPORT_TOOL_OUTPUT,
  cutToolArgs,
  stripKiroContext,
} from '../../src/utils/kiroSessions.ts';
import type {
  KiroImportedMessage,
  KiroImportedToolCall,
  KiroSessionOpenResponse,
} from '../../src/utils/kiroSessions.ts';
import type { ConfigOption, LoadSessionResult, SessionUpdate } from '../acp/types.ts';
import { createUpdateMapper } from '../acp/updates.ts';
import { createKiroReplyMeta, kiroToolName } from './reply-meta.ts';
import type { KiroReplyMeta } from './reply-meta.ts';

/** The text of a tool call that has no result at the end of the replay */
export const KIRO_REPLAY_NO_RESULT = 'The reply ended before this tool returned a result.';

/** Room for the other fields of the response, in bytes */
const ENVELOPE_BYTES = 64 * 1024;

export type KiroReplayResult = Pick<
  KiroSessionOpenResponse,
  'messages' | 'turns' | 'imagesLeftOut' | 'turnsLeftOut' | 'model'
>;

export interface KiroReplayCollector {
  onUpdate(update: SessionUpdate): void;
  /** The turns after `skipTurns`, cut to fit KIRO_IMPORT_MAX_BYTES (`maxBytes` for tests) */
  finish(load: LoadSessionResult, maxBytes?: number): KiroReplayResult;
}

interface Turn {
  /** The `messageId` of the turn's user message */
  userId?: string;
  started: boolean;
  /** Kiro sent the turn's turn_end */
  ended: boolean;
  /** False for the turns before skipTurns: counted, not mapped */
  mapped: boolean;
  userText: string;
  images: number;
  content: string;
  reasoning: string;
  tools: Map<string, KiroImportedToolCall>;
  meta?: KiroReplyMeta;
  onUpdate?: (update: SessionUpdate) => void;
  /** The last update was a user chunk */
  inUser: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const kiroMeta = (update: SessionUpdate) => asRecord(asRecord(update._meta)?.kiro);

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The session's model from the load answer's config options */
export function kiroReplayModel(
  configOptions: ConfigOption[] | undefined
): { id: string; name: string } | undefined {
  const option = configOptions?.find((o) => o.id === 'model');
  if (!option || typeof option.currentValue !== 'string' || !option.currentValue) return undefined;
  const id = option.currentValue;
  const name = option.options?.find((o) => o.value === id)?.name;
  return { id, name: typeof name === 'string' && name ? name : id };
}

export function createKiroReplayCollector(skipTurns: number): KiroReplayCollector {
  const turns: Turn[] = [];
  let current: Turn | undefined;

  const startTurn = (userId?: string): Turn => {
    const turn: Turn = {
      userId,
      started: false,
      ended: false,
      mapped: turns.length >= skipTurns,
      userText: '',
      images: 0,
      content: '',
      reasoning: '',
      tools: new Map(),
      inUser: false,
    };
    if (turn.mapped) {
      const meta = createKiroReplyMeta({ prompt: '', title: undefined, send: () => undefined });
      const mapper = createUpdateMapper({
        send(event) {
          if ('content' in event) turn.content += event.content;
          else if ('reasoning' in event) turn.reasoning += event.reasoning;
          else if ('toolCall' in event) {
            const { id, name, args } = event.toolCall;
            turn.tools.set(id, {
              toolCallId: id,
              toolName: name,
              args: cutToolArgs(args),
              status: 'error',
            });
          } else {
            const { id, result, error } = event.toolResult;
            const tool = turn.tools.get(id);
            if (!tool) return;
            tool.status = error === undefined ? 'complete' : 'error';
            tool.result = cut(error ?? result ?? '', KIRO_IMPORT_TOOL_OUTPUT);
          }
        },
        toolName: kiroToolName,
        // The app denies nothing in a replay
        onOther: meta.onUpdate,
      });
      turn.meta = meta;
      turn.onUpdate = mapper.onUpdate;
    }
    turns.push(turn);
    current = turn;
    return turn;
  };

  const onUpdate = (update: SessionUpdate) => {
    const kiro = kiroMeta(update);
    if (kiro?.replay !== true) return;
    if (update.sessionUpdate === 'user_message_chunk') {
      const messageId = typeof kiro.messageId === 'string' ? kiro.messageId : undefined;
      let turn = current;
      const sameMessage = turn && (messageId ? turn.userId === messageId : turn.inUser);
      // A turn that turn_start began, with no user text and no reply yet
      const firstUser =
        turn &&
        turn.userId === undefined &&
        !turn.inUser &&
        !turn.userText &&
        !turn.images &&
        !turn.content &&
        !turn.tools.size;
      if (!turn || (!sameMessage && !firstUser)) turn = startTurn(messageId);
      else if (firstUser) turn.userId = messageId;
      turn.inUser = true;
      const content = asRecord(update.content);
      if (content?.type === 'text' && typeof content.text === 'string') {
        turn.userText += content.text;
      } else if (content?.type === 'image') {
        turn.images += 1;
      }
      return;
    }
    if (update.sessionUpdate === 'session_info_update' && kiro.kind === 'turn_start') {
      if (!current || current.started) startTurn().started = true;
      else current.started = true;
      current!.inUser = false;
      return;
    }
    // Updates before the first turn (for example the session's usage) belong to no reply
    if (!current) return;
    if (update.sessionUpdate === 'session_info_update' && kiro.kind === 'turn_end') {
      current.ended = true;
    }
    current.inUser = false;
    current.onUpdate?.(update);
  };

  const finish = (load: LoadSessionResult, maxBytes = KIRO_IMPORT_MAX_BYTES): KiroReplayResult => {
    // A last turn that Kiro has not ended runs now (the session is in progress): leave it out
    // and do not count it, so that the next sync gets it in full
    const last = turns[turns.length - 1];
    const running =
      last !== undefined && !last.ended && (last.started || turns.some((t) => t.ended));
    const complete = running ? turns.slice(0, -1) : turns;
    const pairs: KiroImportedMessage[][] = [];
    const images: number[] = [];
    for (const turn of complete) {
      if (!turn.mapped) continue;
      const user: KiroImportedMessage = {
        role: 'user',
        content: cut(stripKiroContext(turn.userText), KIRO_IMPORT_TEXT_CHARS),
      };
      const tools = [...turn.tools.values()].map((tool) =>
        tool.result === undefined ? { ...tool, result: KIRO_REPLAY_NO_RESULT } : tool
      );
      const credits = turn.meta?.credits;
      const contextPercent = turn.meta?.contextPercent;
      const latencyMs = turn.meta?.elapsedMs;
      // A reply with no text that Kiro ended with an error, as the live chat shows it
      const displayError = turn.meta?.displayError;
      const text = !turn.content.trim() && displayError ? `_${displayError}_` : turn.content;
      const assistant: KiroImportedMessage = {
        role: 'assistant',
        content: cut(text, KIRO_IMPORT_TEXT_CHARS),
        ...(turn.reasoning && { reasoning: cut(turn.reasoning, KIRO_IMPORT_REASONING_CHARS) }),
        ...(tools.length > 0 && { toolCalls: tools }),
        ...(credits !== undefined && { credits }),
        ...(contextPercent !== undefined && { contextPercent }),
        ...(latencyMs !== undefined && { latencyMs }),
      };
      pairs.push([user, assistant]);
      images.push(turn.images);
    }

    // The newest turns first, while they fit
    let bytes = ENVELOPE_BYTES;
    let first = pairs.length;
    while (first > 0) {
      const size = Buffer.byteLength(JSON.stringify(pairs[first - 1]), 'utf8') + 2;
      if (bytes + size > maxBytes) break;
      bytes += size;
      first -= 1;
    }
    const model = kiroReplayModel(load.configOptions);
    return {
      messages: pairs.slice(first).flat(),
      turns: complete.length,
      imagesLeftOut: images.slice(first).reduce((sum, n) => sum + n, 0),
      turnsLeftOut: first,
      ...(model && { model }),
    };
  };

  return { onUpdate, finish };
}
