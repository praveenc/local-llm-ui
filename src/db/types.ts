/**
 * Database types for conversation persistence
 */
import type { KiroSessionSync } from '../utils/kiroSessions';
import type { SessionOptionValues } from '../utils/sessionOptions';
import type { ThinkingEffort } from '../utils/thinkingEffort';
import type { StoredToolCall } from '../utils/toolResults';
import type { MessageUsage } from '../utils/usage';

export type Provider =
  | 'lmstudio'
  | 'ollama'
  | 'bedrock'
  | 'bedrock-mantle'
  | 'groq'
  | 'cerebras'
  | 'anthropic'
  | 'openrouter'
  | 'kiro';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'active' | 'archived';
/** The user's thumbs up or thumbs down on an assistant message */
export type MessageFeedback = 'helpful' | 'not-helpful';

/**
 * A file of a user message, as the message row keeps it (D-C). The bytes are in the
 * `attachments` table under the same `id`; `kept` is false when they could not be stored.
 */
export interface MessageAttachment {
  id: string;
  name: string;
  format: string;
  sizeBytes: number;
  kept: boolean;
}

/**
 * The bytes of one attached file (schema version 4). `data` is an ArrayBuffer: IndexedDB stores
 * it as it is, and the test database (`fake-indexeddb`) cannot clone a Blob.
 */
export interface StoredAttachment {
  id: string;
  messageId: string;
  conversationId: string;
  name: string;
  mediaType: string;
  size: number;
  data: ArrayBuffer;
}

/** A file to store with a new user message; without `data` only its metadata is kept */
export interface NewAttachment {
  name: string;
  format: string;
  mediaType: string;
  size: number;
  data?: ArrayBuffer;
}

export interface MessageParameters {
  maxTokens?: number;
  thinkingEffort?: ThinkingEffort;
}

/** Token usage of a reply; the same type that the server proxies send */
export type { MessageUsage } from '../utils/usage';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  sequence: number;
  createdAt: Date;
  provider: Provider;
  modelId: string;
  modelName: string;
  parameters?: MessageParameters;
  usage?: MessageUsage;
  /** Tool calls of an assistant reply (web search, MCP tools), with compact results */
  toolCalls?: StoredToolCall[];
  /** About how long the model thought before and between its answer steps */
  reasoningMs?: number;
  attachments?: MessageAttachment[];
  /**
   * An assistant reply: how many files of earlier messages went as a text line, not as bytes,
   * because the request had no room for them (D-E). Not indexed, so no schema version.
   */
  filesNotResent?: number;
  /** Set when the user rates the message; absent until then */
  feedback?: MessageFeedback;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: ConversationStatus;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  providers: Provider[];
  models: string[];
  /**
   * The Kiro session of this chat and how many of its messages the session has seen (D12).
   * `kiro.sessionId` is indexed (schema version 3), so an imported session finds its chat.
   */
  kiro?: KiroConversationSession;
  /** The user renamed the chat, so Kiro's title does not replace it */
  titleEdited?: boolean;
  /** The title is Kiro's short title, so a later Kiro title may replace it */
  titleFromKiro?: boolean;
  /**
   * The agent and option picks that no Kiro reply has applied yet (K9, D27), so a reload keeps
   * them. Not under `kiro`: a chat has no `kiro` before its first Kiro reply, and
   * `setKiroSession` rewrites it. Not indexed, so no schema version.
   */
  kiroPicks?: SessionOptionValues;
}

/** Also Kiro's `updatedAt` and turn count at the last import or sync (K7) */
export interface KiroConversationSession extends KiroSessionSync {
  sessionId: string;
  /** How many of the chat's messages (with text, from the start) the session has seen */
  seenMessages: number;
  /** The session's agent and other option values as Kiro last reported them (K9) */
  options?: SessionOptionValues;
}

// Input types for creating new records (id is auto-generated)
export type CreateConversationInput = Omit<Conversation, 'id'>;
export type CreateMessageInput = Omit<Message, 'id'>;

/**
 * Saved Prompts types
 */
export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateSavedPromptInput = Omit<SavedPrompt, 'id'>;
