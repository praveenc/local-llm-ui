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
  KiroConversationSession,
  Message,
  MessageFeedback,
  Provider,
} from '../db';
import type { SessionOptionValues } from '../utils/sessionOptions';

// Generate UUID for new records
const generateId = (): string => {
  return crypto.randomUUID();
};

/** The totals of a conversation, built from its messages (as `addMessage` adds them up) */
const totalsOf = (
  messages: Message[]
): Pick<
  Conversation,
  'messageCount' | 'totalInputTokens' | 'totalOutputTokens' | 'providers' | 'models'
> => ({
  messageCount: messages.length,
  totalInputTokens: messages.reduce((n, m) => n + (m.usage?.inputTokens || 0), 0),
  totalOutputTokens: messages.reduce((n, m) => n + (m.usage?.outputTokens || 0), 0),
  providers: [...new Set(messages.map((m) => m.provider))],
  models: [...new Set(messages.map((m) => m.modelId))],
});

// Generate title from first message content
const generateTitle = (content: string, maxLength = 50): string => {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
};

/** The longest title that Kiro may set */
const KIRO_TITLE_MAX = 120;

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
   * Change only the title. The date of the last message (updatedAt) stays, so a renamed
   * chat keeps its place in the sidebar's date groups.
   */
  async rename(id: string, title: string): Promise<void> {
    await db.conversations.update(id, { title, titleEdited: true, titleFromKiro: false });
  },

  /**
   * Store or clear the chat's Kiro session. Does not change updatedAt, like rename. For the same
   * session, the stored option values stay: only `setKiroSessionOptions` changes them (K9).
   */
  async setKiroSession(id: string, kiro: KiroConversationSession | undefined): Promise<void> {
    await db.transaction('rw', db.conversations, async () => {
      const stored = (await db.conversations.get(id))?.kiro;
      const next = kiro && { ...kiro };
      if (next) {
        delete next.options;
        const options =
          stored?.sessionId === next.sessionId && stored.options ? stored.options : kiro?.options;
        if (options) next.options = options;
      }
      await db.conversations.update(id, { kiro: next });
    });
  },

  /**
   * The option values that the chat's Kiro session reported (K9). Ignored when the chat holds
   * another session now.
   */
  async setKiroSessionOptions(
    id: string,
    sessionId: string,
    options: SessionOptionValues
  ): Promise<void> {
    await db.transaction('rw', db.conversations, async () => {
      const kiro = (await db.conversations.get(id))?.kiro;
      if (kiro?.sessionId !== sessionId) return;
      await db.conversations.update(id, { kiro: { ...kiro, options } });
    });
  },

  /**
   * The chat's picks that no Kiro reply has applied yet (D27); undefined or empty removes them.
   * Writes nothing when the stored picks are the same, or the chat does not exist.
   */
  async setKiroPicks(id: string, picks: SessionOptionValues | undefined): Promise<void> {
    const next = picks && Object.keys(picks).length ? { ...picks } : undefined;
    await db.transaction('rw', db.conversations, async () => {
      const conversation = await db.conversations.get(id);
      if (!conversation) return;
      if (JSON.stringify(conversation.kiroPicks) === JSON.stringify(next)) return;
      await db.conversations.update(id, { kiroPicks: next });
    });
  },

  /**
   * Kiro's short title replaces the automatic one, never a title that the user set. A title
   * counts as automatic when it is not marked as edited and still equals the title made from the
   * first user message (a chat renamed before `titleEdited` existed has no flag), or when it is
   * Kiro's own title from earlier (`titleFromKiro`). Does not change updatedAt, like rename.
   */
  async setTitleFromKiro(id: string, title: string): Promise<void> {
    const cleaned = title.trim().replace(/\s+/g, ' ').slice(0, KIRO_TITLE_MAX);
    if (!cleaned) return;
    await db.transaction('rw', [db.conversations, db.messages], async () => {
      const conversation = await db.conversations.get(id);
      if (!conversation || conversation.titleEdited === true) return;
      const messages = await db.messages
        .where('[conversationId+sequence]')
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .toArray();
      const firstUser = messages.find((m) => m.role === 'user');
      const automatic = !!firstUser && conversation.title === generateTitle(firstUser.content);
      if (!automatic && conversation.titleFromKiro !== true) return;
      await db.conversations.update(id, { title: cleaned, titleFromKiro: true });
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
   * Set or clear the user's feedback on a message. Does not touch the
   * conversation's updatedAt, so rating a message does not reorder the list.
   */
  async setMessageFeedback(messageId: string, feedback: MessageFeedback | null): Promise<void> {
    // The update count is 0 also for an unchanged value, so read the row first
    await db.transaction('rw', db.messages, async () => {
      if (!(await db.messages.get(messageId))) throw new Error('Message not found');
      await db.messages.update(messageId, { feedback: feedback ?? undefined });
    });
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
   * Get the newest message, in one conversation or across all of them
   */
  async getLatestMessage(conversationId?: string): Promise<Message | undefined> {
    if (conversationId) {
      return db.messages
        .where('[conversationId+sequence]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .last();
    }
    return db.messages.orderBy('createdAt').last();
  },

  /**
   * Get the newest message sent with a provider, across all conversations
   */
  async getLatestMessageForProvider(provider: Provider): Promise<Message | undefined> {
    return db.messages
      .orderBy('createdAt')
      .reverse()
      .filter((message) => message.provider === provider)
      .first();
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

        // The totals of the messages that stay
        const conversation = await db.conversations.get(conversationId);
        if (conversation) {
          const remaining = await db.messages
            .where('[conversationId+sequence]')
            .between([conversationId, Dexie.minKey], [conversationId, fromSequence], true, false)
            .toArray();
          await db.conversations.update(conversationId, {
            ...totalsOf(remaining),
            updatedAt: new Date(),
          });
        }
      }

      return deleteCount;
    });
  },

  /**
   * Create a new conversation that holds a copy of the first `messageCount`
   * messages (by sequence) of the source conversation. The source is not changed.
   */
  async fork(sourceId: string, messageCount: number): Promise<Conversation> {
    return db.transaction('rw', [db.conversations, db.messages], async () => {
      const source = await db.conversations.get(sourceId);
      if (!source) {
        throw new Error(`Conversation ${sourceId} not found`);
      }

      const sourceMessages = await this.getMessages(sourceId, { limit: messageCount });
      const now = new Date();
      const conversation: Conversation = {
        id: generateId(),
        title: generateTitle(`Fork: ${source.title}`),
        createdAt: now,
        updatedAt: now,
        status: 'active',
        ...totalsOf(sourceMessages),
        // No `kiro`: two chats must not share one Kiro session. The fork's first Kiro prompt
        // opens a new session and sends the copied messages as context (D12).
      };

      await db.conversations.add(conversation);
      await db.messages.bulkAdd(
        sourceMessages.map((m) => ({ ...m, id: generateId(), conversationId: conversation.id }))
      );
      return conversation;
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
