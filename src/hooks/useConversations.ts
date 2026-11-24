/**
 * Hook for listing and filtering conversations
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../db';
import type { Conversation, ConversationStatus } from '../db';

interface UseConversationsOptions {
  status?: ConversationStatus;
  /** Most chats to return; all of them when not given */
  limit?: number;
}

interface UseConversationsResult {
  conversations: Conversation[] | undefined;
  isLoading: boolean;
}

export function useConversations(options?: UseConversationsOptions): UseConversationsResult {
  const { status = 'active', limit } = options || {};

  const conversations = useLiveQuery(async () => {
    const results = await db.conversations
      .where('status')
      .equals(status)
      .reverse()
      .sortBy('updatedAt');

    return limit === undefined ? results : results.slice(0, limit);
  }, [status, limit]);

  return {
    conversations,
    isLoading: conversations === undefined,
  };
}
