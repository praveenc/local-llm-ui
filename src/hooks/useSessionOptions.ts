/**
 * The session options of the open chat (K9): the agent and the other options that the harness
 * lists, with the values to show.
 * - Lists: the last snapshot of the chat's Kiro session in this tab, else Kiro's defaults from
 *   the models response (after a reload). Only values are stored with the conversation.
 * - Values: the lists' values, then the conversation's stored values, then (a new chat only) the
 *   default agent of Preferences (D9), then the user's picks.
 * - Picks: kept in memory per conversation (`NEW_CHAT_KEY` before the chat exists) until the
 *   next reply's snapshot shows what the session took. `useBedrockChat` sends them. The picks of
 *   a chat that exists are also stored with it (`kiroPicks`, D27), so a reload keeps them; the
 *   first read of the chat in this tab takes the stored picks that Kiro still lists.
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { db } from '../db';
import type { Conversation } from '../db/types';
import { conversationService } from '../services/conversationService';
import { kiroService } from '../services/kiro';
import { PREFERENCES_CHANGED_EVENT, loadPreferences } from '../utils/preferences';
import type { SessionOptionValues, SessionOptionsSnapshot } from '../utils/sessionOptions';
import { defaultModeValues, listedValues, withValues } from '../utils/sessionOptions';

/** The key of the picks made in a chat that has no conversation yet */
export const NEW_CHAT_KEY = 'new';

const pendingByChat = new Map<string, SessionOptionValues>();
/** The chats whose picks in memory are the current ones: the stored picks are read or replaced */
const pendingInMemory = new Set<string>();
const pendingListeners = new Set<() => void>();

/** Stores the chat's picks with its conversation (D27); a new chat has no record to store in */
function savePicks(chatKey: string): void {
  pendingInMemory.add(chatKey);
  if (chatKey === NEW_CHAT_KEY) return;
  void conversationService
    .setKiroPicks(chatKey, pendingByChat.get(chatKey))
    .catch((error: unknown) => console.warn('Could not store the Kiro picks:', error));
}

const sameValues = (a: SessionOptionValues | undefined, b: SessionOptionValues | undefined) =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/**
 * The stored picks that Kiro's lists still list. Nothing while the lists are not known: an
 * unlisted value would fail the reply, and the record keeps the picks for a later read.
 */
function storedPicks(
  stored: Pick<Conversation, 'kiro' | 'kiroPicks'> | undefined
): SessionOptionValues | undefined {
  if (!stored?.kiroPicks) return undefined;
  const lists = kiroService.getSessionOptions(stored.kiro?.sessionId);
  return lists ? listedValues(lists, stored.kiroPicks) : undefined;
}

/**
 * Takes the stored picks of a chat into memory, once per chat in this tab (a reload): only the
 * values that Kiro still lists, under any pick made since. Stores the result when it differs.
 */
function loadStoredPicks(
  chatKey: string,
  stored: Pick<Conversation, 'kiro' | 'kiroPicks'> | undefined
): void {
  if (chatKey === NEW_CHAT_KEY || pendingInMemory.has(chatKey)) return;
  // No record (not made yet, or deleted): nothing to read, so the chat is not marked as read
  if (!stored) return;
  // Without Kiro's lists the stored picks cannot be checked: leave them in the record
  if (stored?.kiroPicks && !kiroService.getSessionOptions(stored.kiro?.sessionId)) return;
  const kept = storedPicks(stored);
  const merged = { ...kept, ...pendingByChat.get(chatKey) };
  if (Object.keys(merged).length) pendingByChat.set(chatKey, merged);
  pendingInMemory.add(chatKey);
  // Drops the values that Kiro does not list any more from the record too
  if (!sameValues(stored?.kiroPicks, pendingByChat.get(chatKey))) savePicks(chatKey);
  pendingChanged();
}

/** Forgets every pick in memory, as a reload does (tests) */
export function forgetPendingSessionOptions(): void {
  pendingByChat.clear();
  pendingInMemory.clear();
  pendingChanged();
}

function pendingChanged() {
  for (const listener of pendingListeners) listener();
}

const subscribePending = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

/**
 * The user's picks for this chat that no reply has applied yet. Before the tab has read the
 * chat's stored picks, the stored picks that Kiro still lists (D27).
 */
export function pendingSessionOptions(
  chatKey: string,
  stored?: Pick<Conversation, 'kiro' | 'kiroPicks'>
): SessionOptionValues | undefined {
  if (pendingInMemory.has(chatKey) || pendingByChat.has(chatKey)) return pendingByChat.get(chatKey);
  return storedPicks(stored);
}

/** Records a pick; a pick that equals the value shown without it is removed */
export function setPendingSessionOption(
  chatKey: string,
  id: string,
  value: string,
  shownWithoutPick: string | undefined
): void {
  const before = pendingByChat.get(chatKey);
  const next = { ...before };
  if (value === shownWithoutPick) delete next[id];
  else next[id] = value;
  if (Object.keys(next).length) pendingByChat.set(chatKey, next);
  else pendingByChat.delete(chatKey);
  // Nothing changed: no write
  if (pendingInMemory.has(chatKey) && sameValues(before, pendingByChat.get(chatKey))) return;
  savePicks(chatKey);
  pendingChanged();
}

/** Drops the picks whose value the session now shows; the other picks stay */
function dropApplied(chatKey: string, applied: SessionOptionValues): void {
  const picks = pendingByChat.get(chatKey);
  if (!picks) return;
  const left = Object.entries(picks).filter(([id, value]) => applied[id] !== value);
  if (left.length === Object.keys(picks).length) return;
  if (left.length) pendingByChat.set(chatKey, Object.fromEntries(left));
  else pendingByChat.delete(chatKey);
  savePicks(chatKey);
  pendingChanged();
}

/**
 * Ends the chat's picks after a reply's snapshot. With `applied` (the snapshot's values), only
 * the picks that the session now shows end: a pick that the session did not take, or one made
 * while the reply ran, stays. Without it, every pick ends.
 */
export function clearPendingSessionOptions(chatKey: string, applied?: SessionOptionValues): void {
  const inMemory = pendingInMemory.has(chatKey);
  if (applied) {
    if (inMemory || chatKey === NEW_CHAT_KEY) {
      dropApplied(chatKey, applied);
      return;
    }
    // The tab has not read the stored picks yet (the send used them): read them, then end the
    // ones that the session took
    void db.conversations
      .get(chatKey)
      .then((stored) => {
        loadStoredPicks(chatKey, stored);
        dropApplied(chatKey, applied);
      })
      .catch((error: unknown) => console.warn('Could not read the Kiro picks:', error));
    return;
  }
  const had = pendingByChat.delete(chatKey);
  // A chat that the tab has not read may still have picks in its record
  if (had || !inMemory) savePicks(chatKey);
  if (had) pendingChanged();
}

/**
 * The values that a new chat starts with before the user picks anything (D9): the default agent
 * of Preferences, when Kiro's agent list has it. Nothing when no list is loaded (not Kiro, or Kiro
 * has not answered) or the agent is not listed any more.
 */
function newChatDefaults(): SessionOptionValues | undefined {
  return defaultModeValues(kiroService.getSessionOptions(), loadPreferences().kiroDefaultAgent)
    .values;
}

/**
 * Moves the picks of a new chat to its conversation, when the first message makes it. The default
 * agent of Preferences goes with them, under the picks, so the chat's first Kiro message sends it.
 */
export function movePendingSessionOptions(from: string, to: string): void {
  const picks = pendingByChat.get(from);
  const moved = from === NEW_CHAT_KEY ? { ...newChatDefaults(), ...picks } : picks;
  if (!moved || Object.keys(moved).length === 0) return;
  pendingByChat.delete(from);
  pendingByChat.set(to, { ...pendingByChat.get(to), ...moved });
  savePicks(from);
  savePicks(to);
  pendingChanged();
}

const subscribeDefaultAgent = (listener: () => void) => {
  window.addEventListener(PREFERENCES_CHANGED_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(PREFERENCES_CHANGED_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
};

const readDefaultAgent = () => loadPreferences().kiroDefaultAgent;

interface UseSessionOptionsResult {
  /** The lists with the values to show; null when the harness lists no session options */
  snapshot: SessionOptionsSnapshot | null;
  /** Picks a value for the next message of this chat */
  pick: (id: string, value: string) => void;
  /** Called when the agent picker opens: a new chat gets Kiro's lists again (D26, throttled) */
  refreshLists: () => void;
}

export function useSessionOptions(conversationId: string | null): UseSessionOptionsResult {
  const chatKey = conversationId ?? NEW_CHAT_KEY;
  // `{ id, conversation }` once read: "not read yet" differs from "no record", and a result of
  // the chat that was open before is not taken for this one
  const record = useLiveQuery(
    async () => ({
      id: conversationId,
      conversation: conversationId ? await db.conversations.get(conversationId) : undefined,
    }),
    [conversationId],
    undefined
  );
  const readRecord = record !== undefined && record.id === conversationId;
  const conversation = readRecord ? record.conversation : undefined;
  const kiro = conversation?.kiro;
  const sessionId = kiro?.sessionId;
  const stored = kiro?.options;
  // Both stores keep each value until it changes, so the references are stable
  const lists = useSyncExternalStore(kiroService.subscribeSessionOptions, () =>
    kiroService.getSessionOptions(sessionId)
  );
  const pending = useSyncExternalStore(subscribePending, () => pendingByChat.get(chatKey));
  // After a reload: the stored picks of this chat, once its record and Kiro's lists are known
  useEffect(() => {
    if (readRecord && lists) loadStoredPicks(chatKey, conversation);
  }, [chatKey, readRecord, conversation, lists]);
  // A chat that exists keeps its own agent; only a new chat starts with the default (D9)
  const defaultAgent = useSyncExternalStore(subscribeDefaultAgent, readDefaultAgent);
  const defaults = useMemo(
    () => (chatKey === NEW_CHAT_KEY ? defaultModeValues(lists, defaultAgent).values : undefined),
    [chatKey, lists, defaultAgent]
  );

  const snapshot = useMemo(
    () => (lists ? withValues(lists, stored, defaults, pending) : null),
    [lists, stored, defaults, pending]
  );

  const pick = useCallback(
    (id: string, value: string) => {
      if (!lists) return;
      const apply = (record: Conversation | undefined) => {
        // A chat that exists: start from its stored picks, so a pick does not overwrite them
        loadStoredPicks(chatKey, record);
        const recordLists = kiroService.getSessionOptions(record?.kiro?.sessionId) ?? lists;
        const base = withValues(recordLists, record?.kiro?.options, defaults);
        const option = base.mode?.id === id ? base.mode : base.options.find((o) => o.id === id);
        if (!option || !option.values.some((v) => v.value === value)) return;
        setPendingSessionOption(chatKey, id, value, option.currentValue);
      };
      // The record is not read yet (a few ms after the chat opens): read it, then pick
      if (chatKey !== NEW_CHAT_KEY && !readRecord) {
        void db.conversations
          .get(chatKey)
          .then(apply)
          .catch((error: unknown) => console.warn('Could not read the chat for a pick:', error));
        return;
      }
      apply(conversation);
    },
    [chatKey, lists, defaults, readRecord, conversation]
  );

  // D26: a new chat (no Kiro session yet) asks Kiro for its agent list again, so an agent made
  // in the terminal shows. kiroService throttles it for the whole app. A chat with a session
  // keeps its own list.
  const isNewChat = chatKey === NEW_CHAT_KEY || (readRecord && !sessionId);
  const refreshLists = useCallback(() => {
    if (isNewChat) void kiroService.refreshDefaultSessionOptions();
  }, [isNewChat]);

  return { snapshot, pick, refreshLists };
}
