/**
 * Service for managing conversations and messages in IndexedDB
 */
// Need to import Dexie for minKey/maxKey
import Dexie from 'dexie';

import { db } from '../db';
import type {
  Conversation,
  ConversationStatus,
  CreateMessageInput,
  Message,
  Provider,
} from '../db';

// Generate UUID for new records
const generateId = (): string => {
  return crypto.randomUUID();
};

// Generate title from first message content
const generateTitle = (content: string, maxLength = 50): string => {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
};

export const conversationService = {
  /**
   * Create a new conversation
   */
  async create(title?: string): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: generateId(),
      title: title || 'New Conversation',
      createdAt: now,
      updatedAt: now,
      status: 'active',
      messageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      providers: [],
      models: [],
    };

    await db.conversations.add(conversation);
    return conversation;
  },

  /**
   * Get a conversation by ID
   */
  async get(id: string): Promise<Conversation | undefined> {
    return db.conversations.get(id);
  },

  /**
   * List conversations with optional filtering
   */
  async list(options?: {
    status?: ConversationStatus;
    limit?: number;
    offset?: number;
  }): Promise<Conversation[]> {
    const { status = 'active', limit = 50, offset = 0 } = options || {};

    return db.conversations
      .where('status')
      .equals(status)
      .reverse()
      .sortBy('updatedAt')
      .then((conversations) => conversations.slice(offset, offset + limit));
  },

  /**
   * Update conversation metadata
   */
  async update(
    id: string,
    updates: Partial<Pick<Conversation, 'title' | 'status'>>
  ): Promise<void> {
    await db.conversations.update(id, {
      ...updates,
      updatedAt: new Date(),
    });
  },

  /**
   * Archive a conversation (soft delete)
   */
  async archive(id: string): Promise<void> {
    await db.conversations.update(id, {
      status: 'archived',
      updatedAt: new Date(),
    });
  },

  /**
   * Permanently delete a conversation and its messages
   */
  async delete(id: string): Promise<void> {
    await db.transaction('rw', [db.conversations, db.messages], async () => {
      await db.messages.where('conversationId').equals(id).delete();
      await db.conversations.delete(id);
    });
  },

  /**
   * Add a message to a conversation
   */
  async addMessage(input: CreateMessageInput): Promise<Message> {
    const message: Message = {
      ...input,
      id: generateId(),
    };

    await db.transaction('rw', [db.conversations, db.messages], async () => {
      // Add the message
      await db.messages.add(message);

      // Update conversation metadata
      const conversation = await db.conversations.get(input.conversationId);
      if (conversation) {
        const updates: Partial<Conversation> = {
          updatedAt: new Date(),
          messageCount: conversation.messageCount + 1,
        };

        // Update title from first user message
        if (conversation.messageCount === 0 && input.role === 'user') {
          updates.title = generateTitle(input.content);
        }

        // Track unique providers
        if (!conversation.providers.includes(input.provider)) {
          updates.providers = [...conversation.providers, input.provider];
        }

        // Track unique models
        if (!conversation.models.includes(input.modelId)) {
          updates.models = [...conversation.models, input.modelId];
        }

        // Aggregate token usage
        if (input.usage) {
          updates.totalInputTokens = conversation.totalInputTokens + (input.usage.inputTokens || 0);
          updates.totalOutputTokens =
            conversation.totalOutputTokens + (input.usage.outputTokens || 0);
        }

        await db.conversations.update(input.conversationId, updates);
      }
    });

    return message;
  },

  /**
   * Get messages for a conversation (ordered by sequence)
   */
  async getMessages(
    conversationId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Message[]> {
    const { limit, offset = 0 } = options || {};

    let collection = db.messages
      .where('[conversationId+sequence]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey]);

    if (offset > 0) {
      collection = collection.offset(offset);
    }

    if (limit) {
      collection = collection.limit(limit);
    }

    return collection.toArray();
  },

  /**
   * Get the next sequence number for a conversation
   */
  async getNextSequence(conversationId: string): Promise<number> {
    const lastMessage = await db.messages
      .where('[conversationId+sequence]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .last();

    return lastMessage ? lastMessage.sequence + 1 : 1;
  },

  /**
   * Delete messages after a certain sequence number (inclusive)
   * Used for regeneration to remove old responses and subsequent messages
   */
  async deleteMessagesFromSequence(conversationId: string, fromSequence: number): Promise<number> {
    return db.transaction('rw', [db.conversations, db.messages], async () => {
      // Get messages to delete
      const messagesToDelete = await db.messages
        .where('[conversationId+sequence]')
        .between([conversationId, fromSequence], [conversationId, Dexie.maxKey])
        .toArray();

      const deleteCount = messagesToDelete.length;

      if (deleteCount > 0) {
        // Delete the messages
        await db.messages
          .where('[conversationId+sequence]')
          .between([conversationId, fromSequence], [conversationId, Dexie.maxKey])
          .delete();

        // Update conversation message count
        const conversation = await db.conversations.get(conversationId);
        if (conversation) {
          await db.conversations.update(conversationId, {
            messageCount: Math.max(0, conversation.messageCount - deleteCount),
            updatedAt: new Date(),
          });
        }
      }

      return deleteCount;
    });
  },

  /**
   * Get conversation with its messages
   */
  async getWithMessages(
    id: string
  ): Promise<{ conversation: Conversation; messages: Message[] } | undefined> {
    const conversation = await db.conversations.get(id);
    if (!conversation) return undefined;

    const messages = await this.getMessages(id);
    return { conversation, messages };
  },

  /**
   * Clear all conversations and messages
   */
  async clearAll(): Promise<void> {
    await db.transaction('rw', [db.conversations, db.messages], async () => {
      await db.messages.clear();
      await db.conversations.clear();
    });
  },

  /**
   * Get conversation statistics
   */
  async getStats(): Promise<{
    totalConversations: number;
    activeConversations: number;
    totalMessages: number;
    providerBreakdown: Record<Provider, number>;
  }> {
    const [totalConversations, activeConversations, totalMessages, allMessages] = await Promise.all(
      [
        db.conversations.count(),
        db.conversations.where('status').equals('active').count(),
        db.messages.count(),
        db.messages.toArray(),
      ]
    );

    const providerBreakdown = allMessages.reduce(
      (acc, msg) => {
        acc[msg.provider] = (acc[msg.provider] || 0) + 1;
        return acc;
      },
      {} as Record<Provider, number>
    );

    return {
      totalConversations,
      activeConversations,
      totalMessages,
      providerBreakdown,
    };
  },
};
