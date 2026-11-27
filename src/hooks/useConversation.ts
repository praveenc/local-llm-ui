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

  // The live query keeps its last result when the id changes, until the new query returns. The
  // result carries its id, so the previous chat's messages never show for the new id.
  const result = useLiveQuery(
    async () => {
      if (!conversationId) return undefined;
      const messages = await db.messages
        .where('[conversationId+sequence]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .toArray();
      return { conversationId, messages };
    },
    [conversationId],
    undefined
  );
  const messages = result?.conversationId === conversationId ? result.messages : undefined;

  const isLoading =
    conversationId !== null && (conversation === undefined || messages === undefined);

  return {
    conversation,
    messages,
    isLoading,
  };
}
