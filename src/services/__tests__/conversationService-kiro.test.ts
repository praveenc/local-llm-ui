import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, Message } from '../../db';
import { conversationService } from '../conversationService';

/** A small in-memory stand-in for the two Dexie tables that these methods use */
const store = vi.hoisted(() => ({
  conversations: new Map<string, Record<string, unknown>>(),
  messages: [] as Record<string, unknown>[],
}));

vi.mock('../../db', () => {
  const bySequence = () => {
    let rows: Record<string, unknown>[] = [];
    const chain = {
      between: ([id]: [string]) => {
        rows = store.messages
          .filter((m) => m.conversationId === id)
          .sort((a, b) => (a.sequence as number) - (b.sequence as number));
        return chain;
      },
      offset: (n: number) => {
        rows = rows.slice(n);
        return chain;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return chain;
      },
      toArray: async () => rows,
    };
    return chain;
  };
  return {
    db: {
      transaction: async (_mode: string, _tables: unknown, run: () => Promise<unknown>) => run(),
      conversations: {
        get: async (id: string) => store.conversations.get(id),
        add: async (row: Record<string, unknown>) => {
          store.conversations.set(row.id as string, { ...row });
        },
        update: async (id: string, changes: Record<string, unknown>) => {
          const row = store.conversations.get(id);
          if (row) store.conversations.set(id, { ...row, ...changes });
          return row ? 1 : 0;
        },
      },
      messages: {
        where: () => bySequence(),
        bulkAdd: async (rows: Record<string, unknown>[]) => {
          store.messages.push(...rows);
        },
      },
    },
  };
});

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  title: 'What is the weather',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-02T00:00:00Z'),
  status: 'active',
  messageCount: 2,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  providers: ['kiro'],
  models: ['claude-opus-5.5'],
  ...overrides,
});

const message = (sequence: number, role: 'user' | 'assistant'): Message => ({
  id: `m${sequence}`,
  conversationId: 'c1',
  role,
  content: `${role} ${sequence}`,
  sequence,
  createdAt: new Date(),
  provider: 'kiro',
  modelId: 'claude-opus-5.5',
  modelName: 'Claude Opus 5.5',
});

const SESSION = 'sess_00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  store.conversations.clear();
  store.messages.length = 0;
});

describe('conversationService Kiro fields', () => {
  it('setKiroSession stores and clears the session without changing updatedAt', async () => {
    store.conversations.set('c1', { ...conversation() });
    await conversationService.setKiroSession('c1', { sessionId: SESSION, seenMessages: 2 });
    expect(store.conversations.get('c1')).toMatchObject({
      kiro: { sessionId: SESSION, seenMessages: 2 },
      updatedAt: new Date('2026-11-02T00:00:00Z'),
    });

    await conversationService.setKiroSession('c1', undefined);
    expect(store.conversations.get('c1')?.kiro).toBeUndefined();
  });

  it('setKiroSession keeps the option values of the same session (K9)', async () => {
    const OTHER = 'sess_00000000-0000-4000-8000-000000000002';
    store.conversations.set('c1', {
      ...conversation({
        kiro: { sessionId: SESSION, seenMessages: 0, options: { autopilot: 'off' } },
      }),
    });
    // A later save of the same session with older values keeps the stored ones
    await conversationService.setKiroSession('c1', {
      sessionId: SESSION,
      seenMessages: 2,
      options: { autopilot: 'on' },
    });
    expect(store.conversations.get('c1')?.kiro).toEqual({
      sessionId: SESSION,
      seenMessages: 2,
      options: { autopilot: 'off' },
    });

    // A new session takes the values that come with it, or none
    await conversationService.setKiroSession('c1', {
      sessionId: OTHER,
      seenMessages: 0,
      options: { autopilot: 'on' },
    });
    expect(store.conversations.get('c1')?.kiro).toMatchObject({ options: { autopilot: 'on' } });
    await conversationService.setKiroSession('c1', { sessionId: SESSION, seenMessages: 0 });
    expect(store.conversations.get('c1')?.kiro).toEqual({ sessionId: SESSION, seenMessages: 0 });
  });

  it("setKiroSessionOptions stores the values only for the chat's session", async () => {
    store.conversations.set('c1', {
      ...conversation({ kiro: { sessionId: SESSION, seenMessages: 2 } }),
    });
    await conversationService.setKiroSessionOptions('c1', 'sess_other', { mode: 'agent-b' });
    expect(store.conversations.get('c1')?.kiro).toEqual({ sessionId: SESSION, seenMessages: 2 });

    await conversationService.setKiroSessionOptions('c1', SESSION, { mode: 'agent-b' });
    expect(store.conversations.get('c1')).toMatchObject({
      kiro: { sessionId: SESSION, seenMessages: 2, options: { mode: 'agent-b' } },
      updatedAt: new Date('2026-11-02T00:00:00Z'),
    });
  });

  it('setTitleFromKiro replaces an automatic title, trimmed and capped at 120 characters', async () => {
    store.conversations.set('c1', { ...conversation() });
    store.messages.push({ ...message(1, 'user'), content: '  What is   the weather ' });
    await conversationService.setTitleFromKiro('c1', '  Weather   in Seattle  ');
    expect(store.conversations.get('c1')).toMatchObject({
      title: 'Weather in Seattle',
      updatedAt: new Date('2026-11-02T00:00:00Z'),
    });

    store.conversations.set('c2', { ...conversation({ id: 'c2' }) });
    store.messages.push({
      ...message(1, 'user'),
      conversationId: 'c2',
      content: 'What is the weather',
    });
    await conversationService.setTitleFromKiro('c2', 'x'.repeat(200));
    expect((store.conversations.get('c2')?.title as string).length).toBe(120);
  });

  it('setTitleFromKiro keeps a title that the user set, and ignores an empty title', async () => {
    store.conversations.set('c1', { ...conversation({ title: 'Mine', titleEdited: true }) });
    await conversationService.setTitleFromKiro('c1', 'Kiro title');
    expect(store.conversations.get('c1')?.title).toBe('Mine');

    store.conversations.set('c2', { ...conversation({ id: 'c2', title: 'Auto' }) });
    store.messages.push({ ...message(1, 'user'), conversationId: 'c2', content: 'Auto' });
    await conversationService.setTitleFromKiro('c2', '   ');
    expect(store.conversations.get('c2')?.title).toBe('Auto');
  });

  it('setTitleFromKiro replaces its own earlier title, as Kiro makes a better one', async () => {
    store.conversations.set('c1', { ...conversation() });
    store.messages.push({ ...message(1, 'user'), content: 'What is the weather' });
    await conversationService.setTitleFromKiro('c1', 'Weather');
    await conversationService.setTitleFromKiro('c1', 'Weather in Seattle');
    expect(store.conversations.get('c1')).toMatchObject({
      title: 'Weather in Seattle',
      titleFromKiro: true,
    });
    // A rename after that wins
    await conversationService.rename('c1', 'Trip');
    await conversationService.setTitleFromKiro('c1', 'Weather again');
    expect(store.conversations.get('c1')?.title).toBe('Trip');
  });

  it('setTitleFromKiro keeps a title renamed before the edited flag existed', async () => {
    // No titleEdited flag, but the title is not the one made from the first user message
    store.conversations.set('c1', { ...conversation({ title: 'Trip planning' }) });
    store.messages.push({ ...message(1, 'user'), content: 'What is the weather' });
    await conversationService.setTitleFromKiro('c1', 'Kiro title');
    expect(store.conversations.get('c1')?.title).toBe('Trip planning');
  });

  it('setTitleFromKiro keeps the title of a chat with no user message', async () => {
    store.conversations.set('c1', { ...conversation({ title: 'Fork: Something' }) });
    await conversationService.setTitleFromKiro('c1', 'Kiro title');
    expect(store.conversations.get('c1')?.title).toBe('Fork: Something');
  });

  it('rename marks the title as edited and keeps updatedAt', async () => {
    store.conversations.set('c1', { ...conversation() });
    await conversationService.rename('c1', 'My name');
    expect(store.conversations.get('c1')).toMatchObject({
      title: 'My name',
      titleEdited: true,
      updatedAt: new Date('2026-11-02T00:00:00Z'),
    });
    await conversationService.setTitleFromKiro('c1', 'Kiro title');
    expect(store.conversations.get('c1')?.title).toBe('My name');
  });

  it('fork copies the messages but not the Kiro session or the edited flag', async () => {
    store.conversations.set('c1', {
      ...conversation({
        titleEdited: true,
        kiro: { sessionId: SESSION, seenMessages: 2 },
      }),
    });
    store.messages.push({ ...message(1, 'user') }, { ...message(2, 'assistant') });

    const forked = await conversationService.fork('c1', 2);

    expect(forked.id).not.toBe('c1');
    expect(forked).not.toHaveProperty('kiro');
    expect(forked).not.toHaveProperty('titleEdited');
    expect(store.conversations.get(forked.id)).not.toHaveProperty('kiro');
    expect(store.messages.filter((m) => m.conversationId === forked.id)).toHaveLength(2);
    // The source keeps its session
    expect(store.conversations.get('c1')?.kiro).toEqual({ sessionId: SESSION, seenMessages: 2 });
  });
});
