/**
 * Read the running replies (src/utils/replyStore.ts) in React.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { type ReplyActivity, type ReplyState, replyStore } from '../utils/replyStore';

/** The reply of one chat: running, or ended and not yet dismissed */
export function useReply(conversationId: string | null): ReplyState | undefined {
  const getSnapshot = useCallback(() => replyStore.get(conversationId), [conversationId]);
  return useSyncExternalStore(replyStore.subscribe, getSnapshot);
}

/** The chats with a running reply, for the sidebar. Changes only when a status changes. */
export function useReplyActivity(): ReadonlyMap<string, ReplyActivity> {
  return useSyncExternalStore(replyStore.subscribe, replyStore.activity);
}
