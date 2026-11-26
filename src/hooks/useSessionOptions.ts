/**
 * The session options of the open chat (K9): the agent and the other options that the harness
 * lists, with the values to show.
 * - Lists: the last snapshot of the chat's Kiro session in this tab, else Kiro's defaults from
 *   the models response (after a reload). Only values are stored with the conversation.
 * - Values: the lists' values, then the conversation's stored values, then the user's picks.
 * - Picks: kept in memory per conversation (`NEW_CHAT_KEY` before the chat exists) until the
 *   next reply's snapshot shows what the session took. `useBedrockChat` sends them.
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { db } from '../db';
import { kiroService } from '../services/kiro';
import type { SessionOptionValues, SessionOptionsSnapshot } from '../utils/sessionOptions';
import { withValues } from '../utils/sessionOptions';

/** The key of the picks made in a chat that has no conversation yet */
export const NEW_CHAT_KEY = 'new';

const pendingByChat = new Map<string, SessionOptionValues>();
const pendingListeners = new Set<() => void>();

function pendingChanged() {
  for (const listener of pendingListeners) listener();
}

const subscribePending = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

/** The user's picks for this chat that no reply has applied yet */
export function pendingSessionOptions(chatKey: string): SessionOptionValues | undefined {
  return pendingByChat.get(chatKey);
}

/** Records a pick; a pick that equals the value shown without it is removed */
export function setPendingSessionOption(
  chatKey: string,
  id: string,
  value: string,
  shownWithoutPick: string | undefined
): void {
  const next = { ...pendingByChat.get(chatKey) };
  if (value === shownWithoutPick) delete next[id];
  else next[id] = value;
  if (Object.keys(next).length) pendingByChat.set(chatKey, next);
  else pendingByChat.delete(chatKey);
  pendingChanged();
}

/** Drops the chat's picks: the session's snapshot now shows the values */
export function clearPendingSessionOptions(chatKey: string): void {
  if (pendingByChat.delete(chatKey)) pendingChanged();
}

/** Moves the picks of a new chat to its conversation, when the first message makes it */
export function movePendingSessionOptions(from: string, to: string): void {
  const picks = pendingByChat.get(from);
  if (!picks) return;
  pendingByChat.delete(from);
  pendingByChat.set(to, { ...pendingByChat.get(to), ...picks });
  pendingChanged();
}

interface UseSessionOptionsResult {
  /** The lists with the values to show; null when the harness lists no session options */
  snapshot: SessionOptionsSnapshot | null;
  /** Picks a value for the next message of this chat */
  pick: (id: string, value: string) => void;
}

export function useSessionOptions(conversationId: string | null): UseSessionOptionsResult {
  const chatKey = conversationId ?? NEW_CHAT_KEY;
  const kiro = useLiveQuery(
    async () => (conversationId ? (await db.conversations.get(conversationId))?.kiro : undefined),
    [conversationId],
    undefined
  );
  const sessionId = kiro?.sessionId;
  const stored = kiro?.options;
  // Both stores keep each value until it changes, so the references are stable
  const lists = useSyncExternalStore(kiroService.subscribeSessionOptions, () =>
    kiroService.getSessionOptions(sessionId)
  );
  const pending = useSyncExternalStore(subscribePending, () => pendingByChat.get(chatKey));

  const snapshot = useMemo(
    () => (lists ? withValues(lists, stored, pending) : null),
    [lists, stored, pending]
  );

  const pick = useCallback(
    (id: string, value: string) => {
      if (!lists) return;
      const base = withValues(lists, stored);
      const option = base.mode?.id === id ? base.mode : base.options.find((o) => o.id === id);
      if (!option || !option.values.some((v) => v.value === value)) return;
      setPendingSessionOption(chatKey, id, value, option.currentValue);
    },
    [chatKey, lists, stored]
  );

  return { snapshot, pick };
}
