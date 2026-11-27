/**
 * AI SDK UIMessage types and adapter functions
 *
 * These types align with AI SDK's UIMessage format used by AI Elements components.
 * Adapter functions convert between our DB format and UIMessage format.
 */
import type {
  Message as DbMessage,
  MessageFeedback,
  MessageUsage,
  Provider,
  StoredAttachment,
} from '../db/types';
import { type ToolApproval, readStoredApprovals } from '../utils/kiroPermissions';
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
  /** Size of the file in bytes, when known */
  size?: number;
  /** False when the app could not keep the bytes: the chat says "File not kept" (D-C) */
  kept?: boolean;
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
  /** Kiro's questions about this tool call, in order (K6). Stored ones are never open. */
  approvals?: ToolApproval[];
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
  /** The user's thumbs up or thumbs down, when set */
  feedback?: MessageFeedback;
  /** The model that wrote an assistant message */
  model?: { provider: Provider; id: string; name?: string };
  /** Token usage of an assistant message, when the provider sent it */
  usage?: MessageUsage;
  /** About how long the model thought, for the work row */
  reasoningMs?: number;
  /** An assistant reply: how many earlier files went as a text line, not as bytes (D-E) */
  filesNotResent?: number;
}

/**
 * Convert a database message to UIMessage format
 */
export function toUIMessage(
  dbMessage: DbMessage,
  files?: ReadonlyMap<string, StoredAttachment>
): UIMessage {
  const parts: MessagePart[] = [];

  // Parse thinking content if present (for models like DeepSeek)
  const { thinkingContent, mainContent } = parseThinkingContent(dbMessage.content);

  if (thinkingContent) {
    parts.push({
      type: 'reasoning',
      reasoning: thinkingContent,
    });
  }

  // Tool calls go between the thinking and the answer, as while the reply streamed
  for (const { approvals, ...toolCall } of dbMessage.toolCalls ?? []) {
    const stored = readStoredApprovals(approvals);
    parts.push({ type: 'tool-call', ...toolCall, ...(stored && { approvals: stored }) });
  }

  if (mainContent) {
    parts.push({
      type: 'text',
      text: mainContent,
    });
  }

  // File attachments, with their stored bytes; a file without bytes is marked not kept
  for (const attachment of dbMessage.attachments ?? []) {
    const stored = attachment.kept ? files?.get(attachment.id) : undefined;
    parts.push({
      type: 'file',
      filename: attachment.name,
      mediaType: stored?.mediaType ?? getMediaTypeFromFormat(attachment.format),
      size: attachment.sizeBytes,
      ...(stored ? { data: bytesToBase64(stored.data) } : { kept: false }),
    });
  }

  return {
    id: dbMessage.id,
    role: dbMessage.role === 'system' ? 'system' : dbMessage.role,
    parts,
    createdAt: dbMessage.createdAt,
    ...(dbMessage.feedback ? { feedback: dbMessage.feedback } : {}),
    ...(dbMessage.role === 'assistant' && {
      model: { provider: dbMessage.provider, id: dbMessage.modelId, name: dbMessage.modelName },
    }),
    ...(dbMessage.usage ? { usage: dbMessage.usage } : {}),
    ...(dbMessage.reasoningMs ? { reasoningMs: dbMessage.reasoningMs } : {}),
    ...(dbMessage.filesNotResent ? { filesNotResent: dbMessage.filesNotResent } : {}),
  };
}

/**
 * Convert array of database messages to UIMessage array. `files` are the stored bytes of the
 * chat's attachments (`conversationService.getAttachments`); without them every file part is
 * marked not kept.
 */
export function toUIMessages(
  dbMessages: DbMessage[],
  files?: readonly StoredAttachment[]
): UIMessage[] {
  const byId = new Map((files ?? []).map((file) => [file.id, file]));
  return dbMessages.map((m) => toUIMessage(m, byId));
}

// The chat converts the same stored bytes again on each message write: keep the text
const base64Cache = new WeakMap<ArrayBuffer, string>();

/** Base64 text of stored bytes */
export function bytesToBase64(data: ArrayBuffer): string {
  const cached = base64Cache.get(data);
  if (cached !== undefined) return cached;
  const bytes = new Uint8Array(data);
  let binary = '';
  // In chunks: one call with millions of arguments overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const text = btoa(binary);
  base64Cache.set(data, text);
  return text;
}

/** The bytes of base64 text */
export function base64ToBytes(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The size in bytes of base64 text */
export function base64Size(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
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
