/**
 * Hook for loading a single conversation with its messages
 */
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../db';
import type { Conversation, Message, StoredAttachment } from '../db';

interface UseConversationResult {
  conversation: Conversation | undefined;
  messages: Message[] | undefined;
  /**
   * The stored bytes of the chat's attached files (D-C). Set when `messages` is set, so a file
   * never shows as not kept while its bytes load.
   */
  attachments: StoredAttachment[] | undefined;
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

  // The bytes in their own query: a message write (each reply) does not read them again
  const files = useLiveQuery(
    async () => {
      if (!conversationId) return undefined;
      const attachments = await db.attachments
        .where('conversationId')
        .equals(conversationId)
        .toArray();
      return { conversationId, attachments };
    },
    [conversationId],
    undefined
  );
  const attachments = files?.conversationId === conversationId ? files.attachments : undefined;
  const messages =
    result?.conversationId === conversationId && attachments ? result.messages : undefined;

  const isLoading =
    conversationId !== null && (conversation === undefined || messages === undefined);

  return {
    conversation,
    messages,
    attachments: messages ? attachments : undefined,
    isLoading,
  };
}
