/**
 * Import a Kiro session into a conversation, and add the turns that Kiro made later (K7). The
 * messages come from the open route (`kiroService.openSession`), which reads them from Kiro's
 * replay of the session. Each write is one Dexie transaction, so a chat is never half imported.
 */
import Dexie from 'dexie';

import { db } from '../db';
import type { Conversation, Message, MessageUsage } from '../db';
import { getTextContent, toUIMessages } from '../types/ai-messages';
import {
  type KiroImportedMessage,
  type KiroSessionOpenResponse,
  countTextMessages,
  seenAfterSync,
} from '../utils/kiroSessions';

/** The longest title that Kiro may set, as for a Kiro title in a chat */
const TITLE_MAX = 120;

export interface KiroModelRef {
  id: string;
  name: string;
}

/** Kiro's own choice of model, for a session whose model Kiro does not say */
export const KIRO_AUTO_MODEL: KiroModelRef = { id: 'auto', name: 'auto' };

/** The conversation that holds this Kiro session, if one does */
export async function findConversationByKiroSession(
  sessionId: string
): Promise<Conversation | undefined> {
  return db.conversations.where('kiro.sessionId').equals(sessionId).first();
}

function cleanTitle(title: string): string {
  const cleaned = title.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX);
  return cleaned || 'Kiro session';
}

/** Stored as `useBedrockChat` stores a reply: the thinking in `<think>` tags before the text */
function storedContent(message: KiroImportedMessage): string {
  return message.role === 'assistant' && message.reasoning
    ? `<think>${message.reasoning}</think>\n${message.content}`
    : message.content;
}

function storedUsage(message: KiroImportedMessage): MessageUsage | undefined {
  if (message.role !== 'assistant') return undefined;
  const usage: MessageUsage = {
    ...(message.credits !== undefined && { credits: message.credits }),
    ...(message.contextPercent !== undefined && { contextPercent: message.contextPercent }),
    ...(message.latencyMs !== undefined && { latencyMs: message.latencyMs }),
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function toStoredMessages(
  conversationId: string,
  messages: readonly KiroImportedMessage[],
  firstSequence: number,
  model: KiroModelRef,
  createdAt: Date
): Message[] {
  return messages.map((message, index) => {
    const usage = storedUsage(message);
    return {
      id: crypto.randomUUID(),
      conversationId,
      role: message.role,
      content: storedContent(message),
      sequence: firstSequence + index,
      createdAt,
      provider: 'kiro',
      modelId: model.id,
      modelName: model.name,
      ...(usage && { usage }),
      ...(message.toolCalls?.length && { toolCalls: message.toolCalls }),
    };
  });
}

/**
 * Makes a conversation from a Kiro session and returns its id. When a conversation already
 * holds the session (a second click, or another tab), returns that one and changes nothing.
 * `fallbackModel` is used when Kiro does not say the session's model.
 */
export async function importKiroSession(
  sessionId: string,
  session: KiroSessionOpenResponse,
  fallbackModel: KiroModelRef
): Promise<string> {
  return db.transaction('rw', [db.conversations, db.messages], async () => {
    const existing = await findConversationByKiroSession(sessionId);
    if (existing) return existing.id;

    const model = session.model ?? fallbackModel;
    const updatedAt = new Date(session.updatedAt);
    const id = crypto.randomUUID();
    const messages = toStoredMessages(id, session.messages, 0, model, updatedAt);
    const conversation: Conversation = {
      id,
      title: cleanTitle(session.title),
      createdAt: updatedAt,
      updatedAt,
      status: 'active',
      messageCount: messages.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      providers: ['kiro'],
      models: [model.id],
      // Kiro has seen every imported message: the next prompt sends only the new one
      kiro: {
        sessionId,
        seenMessages: countTextMessages(session.messages),
        updatedAt: session.updatedAt,
        turns: session.turns,
      },
      titleFromKiro: true,
    };
    await db.conversations.add(conversation);
    if (messages.length > 0) await db.messages.bulkAdd(messages);
    return id;
  });
}

/**
 * Adds the turns that Kiro made after the conversation's last import or sync (turns in the
 * terminal) at the end of the chat. `session` must hold only the turns after the stored
 * `kiro.turns` (the open route with `skipTurns`). When Kiro's history is shorter than the stored
 * count, nothing is added: the chat keeps its messages. Returns how many messages were added.
 */
export async function appendKiroTurns(
  conversationId: string,
  session: KiroSessionOpenResponse
): Promise<number> {
  return db.transaction('rw', [db.conversations, db.messages], async () => {
    const conversation = await db.conversations.get(conversationId);
    const kiro = conversation?.kiro;
    if (!conversation || !kiro || kiro.turns === undefined) return 0;

    if (session.turns <= kiro.turns || session.messages.length === 0) {
      // Nothing new, or a shorter history: keep the chat as it is and remember Kiro's time
      await db.conversations.update(conversationId, {
        kiro: { ...kiro, updatedAt: session.updatedAt },
      });
      return 0;
    }

    const stored = await db.messages
      .where('[conversationId+sequence]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .toArray();
    const last = stored[stored.length - 1];
    const model =
      session.model ?? (last ? { id: last.modelId, name: last.modelName } : KIRO_AUTO_MODEL);
    const kiroTime = new Date(session.updatedAt);
    const added = toStoredMessages(
      conversationId,
      session.messages,
      (last?.sequence ?? -1) + 1,
      model,
      kiroTime
    );
    await db.messages.bulkAdd(added);

    // The messages with text, counted as the chat counts its history for Kiro
    const textMessages = toUIMessages(stored).filter(
      (m) => m.role !== 'system' && getTextContent(m).trim().length > 0
    ).length;
    await db.conversations.update(conversationId, {
      messageCount: conversation.messageCount + added.length,
      updatedAt: kiroTime > conversation.updatedAt ? kiroTime : conversation.updatedAt,
      ...(!conversation.models.includes(model.id) && {
        models: [...conversation.models, model.id],
      }),
      ...(!conversation.providers.includes('kiro') && {
        providers: [...conversation.providers, 'kiro' as const],
      }),
      kiro: {
        ...kiro,
        seenMessages: seenAfterSync(kiro.seenMessages, textMessages, session.messages),
        updatedAt: session.updatedAt,
        turns: session.turns,
      },
    });
    return added.length;
  });
}
