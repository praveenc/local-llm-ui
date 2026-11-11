/**
 * Database types for conversation persistence
 */
import type { ThinkingEffort } from '../utils/thinkingEffort';

export type Provider =
  | 'lmstudio'
  | 'ollama'
  | 'bedrock'
  | 'bedrock-mantle'
  | 'groq'
  | 'cerebras'
  | 'anthropic'
  | 'openrouter';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'active' | 'archived';
/** The user's thumbs up or thumbs down on an assistant message */
export type MessageFeedback = 'helpful' | 'not-helpful';

export interface MessageAttachment {
  name: string;
  format: string;
  sizeBytes: number;
}

export interface MessageParameters {
  maxTokens?: number;
  thinkingEffort?: ThinkingEffort;
}

export interface MessageUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

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
  attachments?: MessageAttachment[];
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
