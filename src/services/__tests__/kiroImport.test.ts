import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../db';
import type { KiroSessionOpenResponse } from '../../utils/kiroSessions';
import { appendKiroTurns, findConversationByKiroSession, importKiroSession } from '../kiroImport';

const SESSION = 'sess_5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const FALLBACK = { id: 'auto', name: 'Auto' };

const session = (over: Partial<KiroSessionOpenResponse> = {}): KiroSessionOpenResponse => ({
  title: '  Fix the  build ',
  updatedAt: '2026-11-25T10:00:00.000Z',
  model: { id: 'claude-opus-5.5', name: 'Claude Opus 5.5' },
  messages: [
    { role: 'user', content: 'Run the tests' },
    {
      role: 'assistant',
      content: 'All tests pass.',
      reasoning: 'Run npm test first.',
      toolCalls: [
        {
          toolCallId: 't1',
          toolName: 'shell',
          args: { command: 'npm test' },
          status: 'complete',
          result: 'ok',
        },
      ],
      credits: 0.12,
      contextPercent: 4,
      latencyMs: 2900,
    },
    { role: 'user', content: 'Thanks' },
    // A reply with tools only has no text, so the chat's history leaves it out
    { role: 'assistant', content: '' },
  ],
  turns: 2,
  imagesLeftOut: 0,
  turnsLeftOut: 0,
  ...over,
});

const messagesOf = (id: string) =>
  db.messages.where('conversationId').equals(id).sortBy('sequence');

describe('importKiroSession', () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  it('makes a Kiro conversation with the messages as the chat stores them', async () => {
    const id = await importKiroSession(SESSION, session(), FALLBACK);
    const conversation = await db.conversations.get(id);
    expect(conversation).toMatchObject({
      title: 'Fix the build',
      titleFromKiro: true,
      status: 'active',
      providers: ['kiro'],
      models: ['claude-opus-5.5'],
      messageCount: 4,
      kiro: {
        sessionId: SESSION,
        seenMessages: 3,
        updatedAt: '2026-11-25T10:00:00.000Z',
        turns: 2,
      },
    });
    expect(conversation?.updatedAt.toISOString()).toBe('2026-11-25T10:00:00.000Z');

    const messages = await messagesOf(id);
    expect(messages.map((m) => [m.sequence, m.role])).toEqual([
      [0, 'user'],
      [1, 'assistant'],
      [2, 'user'],
      [3, 'assistant'],
    ]);
    expect(messages[1]).toMatchObject({
      content: '<think>Run npm test first.</think>\nAll tests pass.',
      provider: 'kiro',
      modelId: 'claude-opus-5.5',
      modelName: 'Claude Opus 5.5',
      usage: { credits: 0.12, contextPercent: 4, latencyMs: 2900 },
      toolCalls: [{ toolCallId: 't1', status: 'complete', result: 'ok' }],
    });
    expect(messages[0].usage).toBeUndefined();
    expect(messages[3].usage).toBeUndefined();
    expect(await findConversationByKiroSession(SESSION)).toMatchObject({ id });
  });

  it('opens the existing conversation on a second import', async () => {
    const first = await importKiroSession(SESSION, session(), FALLBACK);
    const second = await importKiroSession(SESSION, session({ title: 'Other' }), FALLBACK);
    expect(second).toBe(first);
    expect(await db.conversations.count()).toBe(1);
    expect(await db.messages.count()).toBe(4);
  });

  it('uses the fallback model when Kiro does not say the model', async () => {
    const id = await importKiroSession(SESSION, session({ model: undefined }), FALLBACK);
    expect((await db.conversations.get(id))?.models).toEqual(['auto']);
    expect((await messagesOf(id))[0]).toMatchObject({ modelId: 'auto', modelName: 'Auto' });
  });
});

describe('appendKiroTurns', () => {
  beforeEach(async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });

  const later = (over: Partial<KiroSessionOpenResponse> = {}) =>
    session({
      updatedAt: '2026-11-25T12:00:00.000Z',
      messages: [
        { role: 'user', content: 'One more' },
        { role: 'assistant', content: 'Done.', credits: 0.03 },
      ],
      turns: 3,
      ...over,
    });

  it('adds the new turns at the end, and Kiro has seen them when it saw the whole chat', async () => {
    const id = await importKiroSession(SESSION, session(), FALLBACK);
    expect(await appendKiroTurns(id, later())).toBe(2);
    const messages = await messagesOf(id);
    expect(messages.map((m) => m.content).slice(4)).toEqual(['One more', 'Done.']);
    expect(messages.map((m) => m.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    const conversation = await db.conversations.get(id);
    expect(conversation?.messageCount).toBe(6);
    expect(conversation?.updatedAt.toISOString()).toBe('2026-11-25T12:00:00.000Z');
    expect(conversation?.kiro).toEqual({
      sessionId: SESSION,
      seenMessages: 5,
      updatedAt: '2026-11-25T12:00:00.000Z',
      turns: 3,
    });
  });

  it('keeps seenMessages when the chat has messages that Kiro has not seen', async () => {
    const id = await importKiroSession(SESSION, session(), FALLBACK);
    // A reply of another model, after the import: Kiro has not seen it
    await db.messages.add({
      id: 'app-only',
      conversationId: id,
      role: 'assistant',
      content: 'An answer from another model',
      sequence: 4,
      createdAt: new Date(),
      provider: 'anthropic',
      modelId: 'claude',
      modelName: 'Claude',
    });
    await appendKiroTurns(id, later());
    const conversation = await db.conversations.get(id);
    expect(conversation?.kiro?.seenMessages).toBe(3);
    expect(conversation?.kiro?.turns).toBe(3);
    expect((await messagesOf(id)).map((m) => m.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('adds nothing when Kiro has a shorter history, and keeps the stored turns', async () => {
    const id = await importKiroSession(SESSION, session(), FALLBACK);
    expect(await appendKiroTurns(id, later({ turns: 1, messages: [] }))).toBe(0);
    const conversation = await db.conversations.get(id);
    expect(await db.messages.count()).toBe(4);
    expect(conversation?.kiro).toMatchObject({ turns: 2, updatedAt: '2026-11-25T12:00:00.000Z' });
  });

  it('adds nothing to a chat whose turn count is not known', async () => {
    const id = await importKiroSession(SESSION, session(), FALLBACK);
    await db.conversations.update(id, { kiro: { sessionId: SESSION, seenMessages: 3 } });
    expect(await appendKiroTurns(id, later())).toBe(0);
    expect(await db.messages.count()).toBe(4);
  });
});
