import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterAll, describe, expect, it } from 'vitest';

// Dexie reads the IndexedDB globals when it loads, so give it the fake directly.
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const NAME = 'ChatConversationsDB';
const SESSION = 'sess_0b6f2a52-4c1e-4f7a-9f3e-2d1c0a9b8e77';

const conversation = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Chat ${id}`,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:00:00Z'),
  status: 'active',
  messageCount: 1,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  providers: ['kiro'],
  models: ['auto'],
  ...extra,
});

describe('database schema', () => {
  afterAll(async () => {
    await Dexie.delete(NAME);
  });

  it('opens a version 2 database as version 4, keeps the data, and finds a Kiro session', async () => {
    // A database as the app made it before K7
    const old = new Dexie(NAME);
    old.version(1).stores({
      conversations: 'id, createdAt, updatedAt, status, *providers, *models',
      messages: 'id, conversationId, [conversationId+sequence], createdAt',
    });
    old.version(2).stores({
      conversations: 'id, createdAt, updatedAt, status, *providers, *models',
      messages: 'id, conversationId, [conversationId+sequence], createdAt',
      savedPrompts: 'id, name, category, createdAt',
    });
    await old
      .table('conversations')
      .bulkAdd([
        conversation('c1', { kiro: { sessionId: SESSION, seenMessages: 2 } }),
        conversation('c2'),
      ]);
    await old.table('messages').add({
      id: 'm1',
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      sequence: 0,
      createdAt: new Date(),
    });
    await old.table('savedPrompts').add({ id: 'p1', name: 'Prompt', category: 'x', content: 'y' });
    old.close();

    const { db } = await import('../schema');
    await db.open();
    expect(db.verno).toBe(4);
    expect(await db.conversations.count()).toBe(2);
    expect(await db.messages.get('m1')).toMatchObject({ content: 'hello' });
    expect(await db.savedPrompts.get('p1')).toMatchObject({ name: 'Prompt' });

    const found = await db.conversations.where('kiro.sessionId').equals(SESSION).toArray();
    expect(found.map((c) => c.id)).toEqual(['c1']);
    // A chat without a Kiro session is not in the index
    expect(await db.conversations.where('kiro.sessionId').above('').count()).toBe(1);
    db.close();
  });

  it('opens a version 3 database as version 4, keeps the data, and adds the attachments table', async () => {
    await Dexie.delete(NAME);
    // A database as the app made it in version 1.4.0
    const old = new Dexie(NAME);
    old.version(3).stores({
      conversations: 'id, createdAt, updatedAt, status, *providers, *models, kiro.sessionId',
      messages: 'id, conversationId, [conversationId+sequence], createdAt',
      savedPrompts: 'id, name, category, createdAt',
    });
    await old.table('conversations').add(conversation('c1', { kiro: { sessionId: SESSION } }));
    await old.table('messages').add({
      id: 'm1',
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      sequence: 1,
      createdAt: new Date(),
    });
    await old.table('savedPrompts').add({ id: 'p1', name: 'Prompt', category: 'x', content: 'y' });
    old.close();

    const { db } = await import('../schema');
    await db.open();
    expect(db.verno).toBe(4);
    expect(await db.conversations.where('kiro.sessionId').equals(SESSION).count()).toBe(1);
    expect(await db.messages.get('m1')).toMatchObject({ content: 'hello' });
    expect(await db.savedPrompts.get('p1')).toMatchObject({ name: 'Prompt' });

    // The new table is empty, and finds rows by message and by conversation
    expect(await db.attachments.count()).toBe(0);
    const data = new Uint8Array([137, 80, 78, 71]).buffer;
    await db.attachments.add({
      id: 'a1',
      messageId: 'm1',
      conversationId: 'c1',
      name: 'photo.png',
      mediaType: 'image/png',
      size: 4,
      data,
    });
    expect(await db.attachments.where('messageId').equals('m1').count()).toBe(1);
    const [row] = await db.attachments.where('conversationId').equals('c1').toArray();
    expect([...new Uint8Array(row.data)]).toEqual([137, 80, 78, 71]);
    db.close();
  });
});
