/**
 * Hook for conversation mutations (create, update, delete, add message)
 */
import { useCallback } from 'react';

import type { Conversation, CreateMessageInput, Message } from '../db';
import { conversationService } from '../services';

interface UseConversationMutationsResult {
  createConversation: (title?: string) => Promise<Conversation>;
  archiveConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  addMessage: (input: CreateMessageInput) => Promise<Message>;
  getNextSequence: (conversationId: string) => Promise<number>;
  deleteMessagesFromSequence: (conversationId: string, fromSequence: number) => Promise<number>;
  clearAllConversations: () => Promise<void>;
}

export function useConversationMutations(): UseConversationMutationsResult {
  const createConversation = useCallback(async (title?: string) => {
    return conversationService.create(title);
  }, []);

  const archiveConversation = useCallback(async (id: string) => {
    return conversationService.archive(id);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    return conversationService.delete(id);
  }, []);

  const updateConversationTitle = useCallback(async (id: string, title: string) => {
    return conversationService.update(id, { title });
  }, []);

  const addMessage = useCallback(async (input: CreateMessageInput) => {
    return conversationService.addMessage(input);
  }, []);

  const getNextSequence = useCallback(async (conversationId: string) => {
    return conversationService.getNextSequence(conversationId);
  }, []);

  const deleteMessagesFromSequence = useCallback(
    async (conversationId: string, fromSequence: number) => {
      return conversationService.deleteMessagesFromSequence(conversationId, fromSequence);
    },
    []
  );

  const clearAllConversations = useCallback(async () => {
    return conversationService.clearAll();
  }, []);

  return {
    createConversation,
    archiveConversation,
    deleteConversation,
    updateConversationTitle,
    addMessage,
    getNextSequence,
    deleteMessagesFromSequence,
    clearAllConversations,
  };
}
