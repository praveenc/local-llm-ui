/**
 * Chat messages with files -> AI SDK messages for one provider (D-A c).
 *
 * Each provider gets the files that it reads natively as `file` parts. Text files are decoded as
 * UTF-8 and go into the message text as `<file name="NAME">CONTENT</file>`. A file that the
 * provider cannot take at all is refused before the stream starts (`FileNotAcceptedError`, a
 * 400 that names the file type, never the content).
 */
import type { ModelMessage } from 'ai';
import type { ServerResponse } from 'node:http';

import type { Provider } from '../src/db/types.ts';
import {
  BEDROCK_TEXT_DOCUMENT_FORMATS,
  acceptsKind,
  fileAccepts,
  kindOfFormat,
} from '../src/utils/attachments.ts';
import type { FileKind } from '../src/utils/attachments.ts';
import { lookupMediaType } from '../src/utils/mediaTypes.ts';
import { sendJsonError } from './security.ts';
import type { ChatRequestMessage } from './security.ts';

/** A file that the provider cannot take. The message is safe to send to the browser */
export class FileNotAcceptedError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'FileNotAcceptedError';
  }
}

/** The text part that a message with files and no text gets, in the request only */
export const FILES_ONLY_TEXT = 'See the attached files.';

const KIND_NAMES: Record<FileKind, string> = {
  image: 'Images',
  pdf: 'PDF files',
  office: 'Office files',
  text: 'Text files',
  unsupported: 'Files of this type',
};

const PROVIDER_NAMES: Record<Provider, string> = {
  bedrock: 'Amazon Bedrock',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  groq: 'Groq',
  cerebras: 'Cerebras',
  'bedrock-mantle': 'Bedrock Mantle',
  kiro: 'Kiro',
};

/**
 * Refuse a request whose files the provider cannot take at all. Images count as possible for
 * the providers where they depend on the model (the browser checks the model).
 */
export function checkMessageFiles(messages: ChatRequestMessage[], provider: Provider): void {
  const accepts = fileAccepts(provider, { vision: true });
  for (const message of messages) {
    for (const file of message.files ?? []) {
      const kind = kindOfFormat(file.format);
      if (!acceptsKind(accepts, kind)) {
        throw new FileNotAcceptedError(
          kind === 'unsupported'
            ? 'This file type is not supported'
            : `${KIND_NAMES[kind]} are not supported for ${PROVIDER_NAMES[provider]}`
        );
      }
    }
  }
}

/** True when any file of the request is a PDF */
export const hasPdf = (messages: ChatRequestMessage[]): boolean =>
  messages.some((m) => (m.files ?? []).some((f) => kindOfFormat(f.format) === 'pdf'));

/** A name for an XML attribute */
function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The line for a file that does not decode as text */
export const notReadableLine = (name: string): string => `[File not readable as text: ${name}]`;

/**
 * The text block of a text file. A NUL byte or many replacement characters mean that the file
 * is not text: then the block is a line that says so. Never throws.
 */
export function textFileBlock(name: string, base64: string): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(Buffer.from(base64, 'base64'));
  } catch {
    return notReadableLine(name);
  }
  let replacements = 0;
  for (const ch of text) if (ch === '\uFFFD') replacements += 1;
  if (text.includes('\u0000') || (replacements > 0 && replacements > text.length / 100)) {
    return notReadableLine(name);
  }
  // A file cannot close its own block
  const safe = text.replace(/<\/file/gi, (match) => `<\\/${match.slice(2)}`);
  return `<file name="${escapeAttribute(name)}">\n${safe}\n</file>`;
}

/**
 * A document name that Bedrock Converse takes: letters, digits, single spaces, hyphens,
 * parentheses, and square brackets, at most 200 characters, unique in the message.
 */
export function bedrockDocumentName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const base =
    stem
      .replace(/[^a-zA-Z0-9 ()[\]-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 190)
      .trim() || 'document';
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

type UserPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: Uint8Array; mediaType: string; filename?: string };

/** Whether `provider` takes a file of `kind` and `format` as a `file` part */
function goesAsFilePart(provider: Provider, kind: FileKind, format: string): boolean {
  if (kind === 'image' || kind === 'pdf' || kind === 'office') return true;
  // Bedrock reads some text types as documents (as before); the rest go as text
  return (
    provider === 'bedrock' &&
    (BEDROCK_TEXT_DOCUMENT_FORMATS as readonly string[]).includes(format.toLowerCase())
  );
}

/**
 * The AI SDK messages of a chat request for one provider. Throws `FileNotAcceptedError` for a
 * file that the provider cannot take.
 */
export function toModelMessages(
  messages: ChatRequestMessage[],
  provider: Provider
): ModelMessage[] {
  checkMessageFiles(messages, provider);
  return messages.map((message): ModelMessage => {
    if (message.role === 'system') return { role: 'system', content: message.content };
    if (message.role === 'assistant') return { role: 'assistant', content: message.content };
    const files = message.files ?? [];
    if (files.length === 0) return { role: 'user', content: message.content };

    const used = new Set<string>();
    const fileParts: UserPart[] = [];
    const blocks: string[] = [];
    for (const file of files) {
      const kind = kindOfFormat(file.format);
      if (goesAsFilePart(provider, kind, file.format)) {
        fileParts.push({
          type: 'file',
          data: new Uint8Array(Buffer.from(file.bytes, 'base64')),
          mediaType: lookupMediaType(file.format) ?? 'application/octet-stream',
          filename: provider === 'bedrock' ? bedrockDocumentName(file.name, used) : file.name,
        });
      } else {
        blocks.push(textFileBlock(file.name, file.bytes));
      }
    }
    const text = [message.content, ...blocks].filter((t) => t.trim().length > 0).join('\n\n');
    if (fileParts.length === 0) return { role: 'user', content: text };
    return {
      role: 'user',
      content: [{ type: 'text', text: text || FILES_ONLY_TEXT }, ...fileParts],
    };
  });
}

/** True when `error` is a refused file */
export function isFileNotAccepted(error: unknown): error is FileNotAcceptedError {
  return error instanceof FileNotAcceptedError;
}

/**
 * `toModelMessages` for a proxy: on a refused file it answers the 400 JSON itself and returns
 * null; the proxy then returns. Call it before any key check, MCP start, or SSE header.
 */
export function modelMessagesOr400(
  res: ServerResponse,
  messages: ChatRequestMessage[],
  provider: Provider
): ModelMessage[] | null {
  try {
    return toModelMessages(messages, provider);
  } catch (error) {
    if (!isFileNotAccepted(error)) throw error;
    sendJsonError(res, 400, error.message);
    return null;
  }
}

/** A 400 for any file: for the providers that take no files (Mantle) */
export function refuseFilesOr400(
  res: ServerResponse,
  messages: ChatRequestMessage[],
  provider: Provider
): boolean {
  try {
    checkMessageFiles(messages, provider);
    return true;
  } catch (error) {
    if (!isFileNotAccepted(error)) throw error;
    sendJsonError(res, 400, error.message);
    return false;
  }
}
