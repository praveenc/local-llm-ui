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
  MessageAttachment,
  MessageFeedback,
  NewAttachment,
  Provider,
  StoredAttachment,
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

/** Count a new message in its conversation's totals; run inside the message's transaction */
async function addToTotals(input: CreateMessageInput): Promise<void> {
  const conversation = await db.conversations.get(input.conversationId);
  if (!conversation) return;
  const updates: Partial<Conversation> = {
    updatedAt: new Date(),
    messageCount: conversation.messageCount + 1,
  };

  // Update title from first user message (a message with only files has no text: keep the title)
  if (conversation.messageCount === 0 && input.role === 'user' && input.content.trim()) {
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
    updates.totalOutputTokens = conversation.totalOutputTokens + (input.usage.outputTokens || 0);
  }

  await db.conversations.update(input.conversationId, updates);
}

/** The longest title that Kiro may set */
const KIRO_TITLE_MAX = 120;

/** The most bytes that the stored files of all chats may take, with the rest of the app (D-H) */
export const ATTACHMENT_STORAGE_CAP = 500 * 1024 * 1024;

/**
 * Whether `bytes` more fit under the cap. The browser's estimate of the app's storage when it has
 * one, else the sum of the stored files. Read before the write's transaction: the estimate is
 * not a database promise.
 */
async function roomForFiles(bytes: number): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    const estimate = storage?.estimate ? await storage.estimate() : undefined;
    if (estimate?.usage !== undefined) {
      const after = estimate.usage + bytes;
      return (
        after <= ATTACHMENT_STORAGE_CAP && (estimate.quota === undefined || after <= estimate.quota)
      );
    }
  } catch {
    // No estimate: count the stored files
  }
  // The sizes in the messages' metadata, so no stored bytes are loaded
  let used = 0;
  await db.messages.each((message) => {
    for (const file of message.attachments ?? []) if (file.kept) used += file.sizeBytes;
  });
  return used + bytes <= ATTACHMENT_STORAGE_CAP;
}

/** The name of an error, for a log line that never shows its value */
function errorName(err: unknown): string {
  const name = err && typeof err === 'object' ? (err as { name?: unknown }).name : undefined;
  return typeof name === 'string' && /^\w{1,64}$/.test(name) ? name : 'Error';
}

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
    await db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
      await db.messages.where('conversationId').equals(id).delete();
      await db.attachments.where('conversationId').equals(id).delete();
      await db.conversations.delete(id);
    });
  },

  /**
   * Add a message to a conversation. The files of a user message go into the `attachments`
   * table in the same transaction, and the message keeps their names, formats, and sizes (D-C).
   * Over the storage cap, or when the write with the files fails for any reason, the message is
   * saved with the metadata only (`kept: false`): the text is never lost.
   */
  async addMessage(input: CreateMessageInput, files?: NewAttachment[]): Promise<Message> {
    const id = generateId();
    // A file without bytes (one that was not kept before) keeps its metadata only
    const entries = (files ?? []).map((file) => ({
      file,
      row: file.data && {
        id: generateId(),
        messageId: id,
        conversationId: input.conversationId,
        name: file.name,
        mediaType: file.mediaType,
        size: file.data.byteLength,
        data: file.data,
      },
    }));
    const rows = entries.flatMap(({ row }) => (row ? [row] : []));
    const metadata = (keep: boolean): MessageAttachment[] =>
      entries.map(({ file, row }) => ({
        id: row?.id ?? generateId(),
        name: file.name,
        format: file.format,
        sizeBytes: row?.size ?? file.size,
        kept: keep && !!row,
      }));

    const write = async (keep: boolean): Promise<Message> => {
      const message: Message = {
        ...input,
        id,
        ...(entries.length > 0 && { attachments: metadata(keep) }),
      };
      await db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
        await db.messages.add(message);
        if (keep && rows.length > 0) await db.attachments.bulkAdd(rows);
        await addToTotals(input);
      });
      return message;
    };

    if (rows.length === 0) return write(false);
    const bytes = rows.reduce((n, row) => n + row.size, 0);
    if (!(await roomForFiles(bytes))) return write(false);
    try {
      return await write(true);
    } catch (err) {
      // Any failure of the write with the files (the quota as a BulkError of the request or an
      // AbortError at commit, a DataCloneError, …): the transaction stored nothing, so store
      // the message again without the bytes. The text is never lost for the files' sake.
      console.error(
        `Could not keep the attached files (${errorName(err)}); the message is saved without them`
      );
      return write(false);
    }
  },

  /** The stored file bytes of a conversation's messages */
  async getAttachments(conversationId: string): Promise<StoredAttachment[]> {
    return db.attachments.where('conversationId').equals(conversationId).toArray();
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
    return db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
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
        await db.attachments
          .where('messageId')
          .anyOf(messagesToDelete.map((m) => m.id))
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
    return db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
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

      // The copies get new ids; their files are copied with them (D-G)
      const messageIds = new Map(sourceMessages.map((m) => [m.id, generateId()]));
      const sourceRows = await db.attachments
        .where('messageId')
        .anyOf([...messageIds.keys()])
        .toArray();
      const rowIds = new Map(sourceRows.map((row) => [row.id, generateId()]));

      await db.conversations.add(conversation);
      await db.messages.bulkAdd(
        sourceMessages.map((m) => ({
          ...m,
          id: messageIds.get(m.id)!,
          conversationId: conversation.id,
          ...(m.attachments && {
            attachments: m.attachments.map((a) => ({ ...a, id: rowIds.get(a.id) ?? a.id })),
          }),
        }))
      );
      if (sourceRows.length > 0) {
        await db.attachments.bulkAdd(
          sourceRows.map((row) => ({
            ...row,
            id: rowIds.get(row.id)!,
            messageId: messageIds.get(row.messageId)!,
            conversationId: conversation.id,
          }))
        );
      }
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
    await db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
      await db.messages.clear();
      await db.attachments.clear();
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
