# Conversations Feature - Implementation Plan

## Overview

This document outlines the implementation plan for persisting AI conversations to disk using Dexie.js (IndexedDB wrapper). The feature enables users to save, retrieve, and manage their chat history across sessions, with full support for multi-provider conversations where users can switch models mid-conversation.

## Data Model Design

### Core Entities

#### 1. Conversation

The top-level entity representing a complete chat session.

```typescript
interface Conversation {
  id: string;                    // UUID, primary key
  title: string;                 // Auto-generated or user-defined title
  createdAt: Date;               // When conversation started
  updatedAt: Date;               // Last activity timestamp
  status: 'active' | 'archived'; // Soft delete support

  // Summary metadata
  messageCount: number;          // Total messages in conversation
  totalInputTokens: number;      // Aggregated input tokens
  totalOutputTokens: number;     // Aggregated output tokens

  // Provider tracking (for display purposes)
  providers: string[];           // Unique providers used: ['bedrock', 'lmstudio']
  models: string[];              // Unique models used: ['claude-3-sonnet', 'llama-3']
}
```

#### 2. Message

Individual messages within a conversation. Each message tracks its own model/provider context.

```typescript
interface Message {
  id: string;                    // UUID, primary key
  conversationId: string;        // Foreign key to Conversation

  // Message content
  role: 'user' | 'assistant' | 'system';
  content: string;

  // Ordering
  sequence: number;              // Order within conversation (1, 2, 3...)
  createdAt: Date;

  // Model context (captured at message creation time)
  provider: 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle';
  modelId: string;               // e.g., 'anthropic.claude-3-sonnet-20240229-v1:0'
  modelName: string;             // e.g., 'Claude 3 Sonnet' (display name)

  // Generation parameters (for assistant messages)
  parameters?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  };

  // Usage metrics (for assistant messages)
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  };

  // File attachments (for user messages with Bedrock)
  attachments?: MessageAttachment[];
}

interface MessageAttachment {
  name: string;
  format: string;                // 'pdf', 'txt', 'html', etc.
  sizeBytes: number;
  // Note: We store metadata only, not the actual file content
}
```

### Database Schema (Dexie)

```typescript
import Dexie, { type EntityTable } from 'dexie';

interface ConversationDB extends Dexie {
  conversations: EntityTable<Conversation, 'id'>;
  messages: EntityTable<Message, 'id'>;
}

const db = new Dexie('ChatConversationsDB') as ConversationDB;

db.version(1).stores({
  conversations: 'id, createdAt, updatedAt, status, *providers, *models',
  messages: 'id, conversationId, sequence, createdAt, provider, modelId, [conversationId+sequence]'
});

export { db };
```

### Index Strategy

| Table | Index | Purpose |
|-------|-------|---------|
| conversations | `id` | Primary key lookup |
| conversations | `createdAt` | Sort by creation date |
| conversations | `updatedAt` | Sort by recent activity |
| conversations | `status` | Filter active/archived |
| conversations | `*providers` | Multi-entry index for filtering by provider |
| conversations | `*models` | Multi-entry index for filtering by model |
| messages | `id` | Primary key lookup |
| messages | `conversationId` | Get all messages for a conversation |
| messages | `[conversationId+sequence]` | Compound index for ordered retrieval |
| messages | `provider` | Filter/stats by provider |

## Architecture

### Service Layer

```
src/
├── db/
│   ├── index.ts                 # Database singleton export
│   ├── schema.ts                # Dexie schema definition
│   └── types.ts                 # TypeScript interfaces
├── services/
│   └── conversationService.ts   # CRUD operations for conversations
└── hooks/
    ├── useConversations.ts      # List/filter conversations
    ├── useConversation.ts       # Single conversation with messages
    └── useConversationMutations.ts  # Create/update/delete operations
```

### Key Operations

1. **Create Conversation**: Auto-generate on first message send
2. **Add Message**: Append message with current model context
3. **Load Conversation**: Retrieve conversation + messages (paginated)
4. **List Conversations**: Recent conversations with preview
5. **Search Conversations**: Full-text search on message content
6. **Delete Conversation**: Soft delete (status = 'archived')
7. **Export Conversation**: JSON/Markdown export

## Integration Points

### ChatContainer Changes

1. Accept optional `conversationId` prop
2. On mount: Load existing conversation or create new
3. On message send: Persist user message, then assistant response
4. Track model switches within conversation

### Sidebar Changes

1. Add "Conversations" section below "Model Settings"
2. Show recent conversations list
3. "New Chat" creates fresh conversation
4. Click conversation to load it

### State Management

- Use `useLiveQuery` from `dexie-react-hooks` for reactive updates
- Conversation list auto-updates when new messages arrive
- No need for manual state sync - Dexie handles reactivity

## Migration Strategy

- Version 1: Initial schema (conversations + messages)
- Future versions: Use Dexie's `upgrade()` for schema migrations
- No data migration needed for v1 (fresh start)

## Performance Considerations

1. **Message Pagination**: Load messages in chunks (50 at a time)
2. **Conversation Preview**: Store first message snippet in conversation record
3. **Lazy Loading**: Don't load full message content until conversation opened
4. **Index Optimization**: Compound index for ordered message retrieval

## Security Notes

- All data stored locally in browser's IndexedDB
- No server-side persistence (privacy-first)
- User can clear all data via browser settings
- Consider adding explicit "Clear All Data" button

## Dependencies

```json
{
  "dexie": "^4.0.0",
  "dexie-react-hooks": "^1.1.0"
}
```

## Out of Scope (Future Phases)

- Cloud sync / backup
- Conversation sharing
- Full-text search with fuzzy matching
- Conversation branching (fork from message)
- Message editing / regeneration tracking
