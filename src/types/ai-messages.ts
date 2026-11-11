/**
 * AI SDK UIMessage types and adapter functions
 *
 * These types align with AI SDK's UIMessage format used by AI Elements components.
 * Adapter functions convert between our DB format and UIMessage format.
 */
import type { Message as DbMessage } from '../db/types';
import { getMediaTypeFromFormat } from '../utils/mediaTypes';

/**
 * Text part of a message
 */
export interface TextPart {
  type: 'text';
  text: string;
}

/**
 * Reasoning/thinking part of a message (for models that support it)
 */
export interface ReasoningPart {
  type: 'reasoning';
  reasoning: string;
}

/**
 * File attachment part
 */
export interface FilePart {
  type: 'file';
  filename?: string;
  mediaType?: string;
  url?: string;
  data?: string; // base64 encoded
}

/**
 * Tool call part (for web search, etc.)
 */
export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'complete' | 'error';
}

/**
 * Union of all message part types
 */
export type MessagePart = TextPart | ReasoningPart | FilePart | ToolCallPart;

/**
 * UI Message format compatible with AI SDK and AI Elements
 */
export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  createdAt?: Date;
}

/**
 * Convert a database message to UIMessage format
 */
export function toUIMessage(dbMessage: DbMessage): UIMessage {
  const parts: MessagePart[] = [];

  // Parse thinking content if present (for models like DeepSeek)
  const { thinkingContent, mainContent } = parseThinkingContent(dbMessage.content);

  if (thinkingContent) {
    parts.push({
      type: 'reasoning',
      reasoning: thinkingContent,
    });
  }

  if (mainContent) {
    parts.push({
      type: 'text',
      text: mainContent,
    });
  }

  // Add file attachments if present
  if (dbMessage.attachments && dbMessage.attachments.length > 0) {
    for (const attachment of dbMessage.attachments) {
      parts.push({
        type: 'file',
        filename: attachment.name,
        mediaType: getMediaTypeFromFormat(attachment.format),
      });
    }
  }

  return {
    id: dbMessage.id,
    role: dbMessage.role === 'system' ? 'system' : dbMessage.role,
    parts,
    createdAt: dbMessage.createdAt,
  };
}

/**
 * Convert array of database messages to UIMessage array
 */
export function toUIMessages(dbMessages: DbMessage[]): UIMessage[] {
  return dbMessages.map(toUIMessage);
}

/**
 * Parse thinking content from message (for models like DeepSeek that use <think> tags)
 */
function parseThinkingContent(content: string): {
  thinkingContent: string | null;
  mainContent: string;
} {
  const thinkRegex = /<think>(.*?)<\/think>/s;
  const match = content.match(thinkRegex);

  if (match) {
    const thinkingContent = match[1].trim();
    const mainContent = content.replace(thinkRegex, '').trim();
    return { thinkingContent, mainContent };
  }

  return { thinkingContent: null, mainContent: content };
}

/**
 * Create a new UIMessage from text content
 */
export function createUIMessage(
  role: 'user' | 'assistant',
  content: string,
  id?: string
): UIMessage {
  return {
    id: id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role,
    parts: [{ type: 'text', text: content }],
    createdAt: new Date(),
  };
}

/**
 * Extract text content from UIMessage parts
 */
export function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/**
 * Check if message has reasoning content
 */
export function hasReasoning(message: UIMessage): boolean {
  return message.parts.some((p) => p.type === 'reasoning');
}

/**
 * Get reasoning content from message
 */
export function getReasoningContent(message: UIMessage): string | null {
  const reasoningPart = message.parts.find((p): p is ReasoningPart => p.type === 'reasoning');
  return reasoningPart?.reasoning || null;
}
