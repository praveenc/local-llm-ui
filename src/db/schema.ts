/**
 * Dexie database schema for conversation persistence
 */
import Dexie, { type EntityTable } from 'dexie';

import type { Conversation, Message, SavedPrompt, StoredAttachment } from './types';

export interface ConversationDB extends Dexie {
  conversations: EntityTable<Conversation, 'id'>;
  messages: EntityTable<Message, 'id'>;
  savedPrompts: EntityTable<SavedPrompt, 'id'>;
  attachments: EntityTable<StoredAttachment, 'id'>;
}

const db = new Dexie('ChatConversationsDB') as ConversationDB;

db.version(1).stores({
  // Conversations table indexes:
  // - id: primary key
  // - createdAt, updatedAt: for sorting
  // - status: filter active/archived
  // - *providers, *models: multi-entry indexes for filtering
  conversations: 'id, createdAt, updatedAt, status, *providers, *models',

  // Messages table indexes:
  // - id: primary key
  // - conversationId: get all messages for a conversation
  // - [conversationId+sequence]: compound index for ordered retrieval
  // - createdAt: for time-based queries
  messages: 'id, conversationId, [conversationId+sequence], createdAt',
});

// Version 2: Add savedPrompts table
db.version(2).stores({
  conversations: 'id, createdAt, updatedAt, status, *providers, *models',
  messages: 'id, conversationId, [conversationId+sequence], createdAt',
  // SavedPrompts table indexes:
  // - id: primary key
  // - name: for searching by name
  // - category: for filtering by category
  // - createdAt: for sorting by date
  savedPrompts: 'id, name, category, createdAt',
});

// Version 3: index the Kiro session of a conversation, so an imported Kiro session (K7) finds
// its conversation. No data changes: chats without `kiro` are not in the index.
db.version(3).stores({
  conversations: 'id, createdAt, updatedAt, status, *providers, *models, kiro.sessionId',
  messages: 'id, conversationId, [conversationId+sequence], createdAt',
  savedPrompts: 'id, name, category, createdAt',
});

// Version 4: the bytes of attached files (D-C), apart from the messages, so the chat's message
// query does not read them. No data changes: no message had stored bytes before.
db.version(4).stores({
  conversations: 'id, createdAt, updatedAt, status, *providers, *models, kiro.sessionId',
  messages: 'id, conversationId, [conversationId+sequence], createdAt',
  savedPrompts: 'id, name, category, createdAt',
  attachments: 'id, messageId, conversationId',
});

export { db };
