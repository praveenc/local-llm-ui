/**
 * Dexie database schema for conversation persistence
 */
import Dexie, { type EntityTable } from 'dexie';

import type { Conversation, Message, SavedPrompt } from './types';

export interface ConversationDB extends Dexie {
  conversations: EntityTable<Conversation, 'id'>;
  messages: EntityTable<Message, 'id'>;
  savedPrompts: EntityTable<SavedPrompt, 'id'>;
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

export { db };
