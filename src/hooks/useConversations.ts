/**
 * Hook for listing and filtering conversations
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../db';
import type { Conversation, ConversationStatus } from '../db';

interface UseConversationsOptions {
  status?: ConversationStatus;
  limit?: number;
}

interface UseConversationsResult {
  conversations: Conversation[] | undefined;
  isLoading: boolean;
}

export function useConversations(options?: UseConversationsOptions): UseConversationsResult {
  const { status = 'active', limit = 50 } = options || {};

  const conversations = useLiveQuery(async () => {
    const results = await db.conversations
      .where('status')
      .equals(status)
      .reverse()
      .sortBy('updatedAt');

    return results.slice(0, limit);
  }, [status, limit]);

  return {
    conversations,
    isLoading: conversations === undefined,
  };
}
