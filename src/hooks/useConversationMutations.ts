/**
 * Hook for conversation mutations (create, update, delete, add message)
 */
import { useCallback } from 'react';

import type {
  Conversation,
  CreateMessageInput,
  KiroConversationSession,
  Message,
  MessageFeedback,
  NewAttachment,
} from '../db';
import { conversationService } from '../services';

interface UseConversationMutationsResult {
  createConversation: (title?: string) => Promise<Conversation>;
  archiveConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  /** `files`: the bytes of a user message's attachments, stored with it */
  addMessage: (input: CreateMessageInput, files?: NewAttachment[]) => Promise<Message>;
  getNextSequence: (conversationId: string) => Promise<number>;
  deleteMessagesFromSequence: (conversationId: string, fromSequence: number) => Promise<number>;
  clearAllConversations: () => Promise<void>;
  forkConversation: (sourceId: string, messageCount: number) => Promise<Conversation>;
  setMessageFeedback: (messageId: string, feedback: MessageFeedback | null) => Promise<void>;
  /** The conversation as stored now, for values that the chat reads at send time */
  getConversation: (id: string) => Promise<Conversation | undefined>;
  /** The stored messages of a conversation, in order */
  getMessages: (conversationId: string) => Promise<Message[]>;
  setKiroSession: (id: string, kiro: KiroConversationSession | undefined) => Promise<void>;
  setTitleFromKiro: (id: string, title: string) => Promise<void>;
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
    return conversationService.rename(id, title);
  }, []);

  const addMessage = useCallback(async (input: CreateMessageInput, files?: NewAttachment[]) => {
    return conversationService.addMessage(input, files);
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

  const forkConversation = useCallback(async (sourceId: string, messageCount: number) => {
    return conversationService.fork(sourceId, messageCount);
  }, []);

  const setMessageFeedback = useCallback(
    async (messageId: string, feedback: MessageFeedback | null) => {
      return conversationService.setMessageFeedback(messageId, feedback);
    },
    []
  );

  const getConversation = useCallback(async (id: string) => conversationService.get(id), []);

  const getMessages = useCallback(
    async (conversationId: string) => conversationService.getMessages(conversationId),
    []
  );

  const setKiroSession = useCallback(
    async (id: string, kiro: KiroConversationSession | undefined) =>
      conversationService.setKiroSession(id, kiro),
    []
  );

  const setTitleFromKiro = useCallback(
    async (id: string, title: string) => conversationService.setTitleFromKiro(id, title),
    []
  );

  return {
    createConversation,
    archiveConversation,
    deleteConversation,
    updateConversationTitle,
    addMessage,
    getNextSequence,
    deleteMessagesFromSequence,
    clearAllConversations,
    forkConversation,
    setMessageFeedback,
    getConversation,
    getMessages,
    setKiroSession,
    setTitleFromKiro,
  };
}
