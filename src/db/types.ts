/**
 * Database types for conversation persistence
 */

export type Provider = 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'active' | 'archived';

export interface MessageAttachment {
  name: string;
  format: string;
  sizeBytes: number;
}

export interface MessageParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
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
