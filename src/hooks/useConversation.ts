/**
 * Hook for loading a single conversation with its messages
 */
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../db';
import type { Conversation, Message } from '../db';

interface UseConversationResult {
  conversation: Conversation | undefined;
  messages: Message[] | undefined;
  isLoading: boolean;
}

export function useConversation(conversationId: string | null): UseConversationResult {
  const conversation = useLiveQuery(
    async () => {
      if (!conversationId) return undefined;
      return db.conversations.get(conversationId);
    },
    [conversationId],
    undefined
  );

  const messages = useLiveQuery(
    async () => {
      if (!conversationId) return undefined;
      return db.messages
        .where('[conversationId+sequence]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .toArray();
    },
    [conversationId],
    undefined
  );

  const isLoading =
    conversationId !== null && (conversation === undefined || messages === undefined);

  return {
    conversation,
    messages,
    isLoading,
  };
}
