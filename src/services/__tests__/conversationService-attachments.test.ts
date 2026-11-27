/**
 * The bytes of attached files in the `attachments` table (#102, D-C), with the real Dexie code
 * on `fake-indexeddb`: written with the message, read back, removed and copied with it, and
 * never at the cost of the message text.
 */
import type DexieType from 'dexie';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import type { NewAttachment } from '../../db';
import { ATTACHMENT_STORAGE_CAP, conversationService } from '../conversationService';

// Dexie's error classes from the app's own instance: a value import of 'dexie' here would load
// it before fake-indexeddb is in place
const Dexie = db.constructor as typeof DexieType;

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const PDF = [37, 80, 68, 70, 45];

const file = (name: string, format: string, mediaType: string, bytes: number[]): NewAttachment => ({
  name,
  format,
  mediaType,
  size: bytes.length,
  data: new Uint8Array(bytes).buffer,
});

const userMessage = (
  conversationId: string,
  sequence: number,
  content = `question ${sequence}`
) => ({
  conversationId,
  role: 'user' as const,
  content,
  sequence,
  createdAt: new Date(),
  provider: 'bedrock' as const,
  modelId: 'anthropic.claude',
  modelName: 'Claude',
});

const bytesOf = (data: ArrayBuffer) => [...new Uint8Array(data)];

beforeEach(async () => {
  await conversationService.clearAll();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('conversationService attachments', () => {
  it('stores the files with the user message and reads the bytes back', async () => {
    const { id } = await conversationService.create();
    const saved = await conversationService.addMessage(userMessage(id, 1, 'see these'), [
      file('photo.png', 'png', 'image/png', PNG),
      file('report.pdf', 'pdf', 'application/pdf', PDF),
    ]);

    expect(saved.attachments).toEqual([
      { id: expect.any(String), name: 'photo.png', format: 'png', sizeBytes: 8, kept: true },
      { id: expect.any(String), name: 'report.pdf', format: 'pdf', sizeBytes: 5, kept: true },
    ]);
    const [stored] = await conversationService.getMessages(id);
    expect(stored.content).toBe('see these');
    expect(stored.attachments).toEqual(saved.attachments);

    const rows = await conversationService.getAttachments(id);
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const png = byId.get(saved.attachments![0].id)!;
    expect(png).toMatchObject({ messageId: saved.id, conversationId: id, mediaType: 'image/png' });
    expect(bytesOf(png.data)).toEqual(PNG);
    expect(bytesOf(byId.get(saved.attachments![1].id)!.data)).toEqual(PDF);
    // The conversation counts the message once
    expect((await conversationService.get(id))?.messageCount).toBe(1);
  });

  it('removes the rows with the conversation, from a sequence on, and with clearAll', async () => {
    const a = await conversationService.create();
    const b = await conversationService.create();
    const first = await conversationService.addMessage(userMessage(a.id, 1), [
      file('one.png', 'png', 'image/png', PNG),
    ]);
    await conversationService.addMessage(userMessage(a.id, 2), [
      file('two.pdf', 'pdf', 'application/pdf', PDF),
    ]);
    await conversationService.addMessage(userMessage(b.id, 1), [
      file('other.png', 'png', 'image/png', PNG),
    ]);

    await conversationService.deleteMessagesFromSequence(a.id, 2);
    const left = await conversationService.getAttachments(a.id);
    expect(left.map((row) => row.messageId)).toEqual([first.id]);

    await conversationService.delete(a.id);
    expect(await conversationService.getAttachments(a.id)).toEqual([]);
    expect(await conversationService.getAttachments(b.id)).toHaveLength(1);

    await conversationService.clearAll();
    expect(await db.attachments.count()).toBe(0);
  });

  it('copies the rows to a fork with the new message ids', async () => {
    const { id } = await conversationService.create();
    const source = await conversationService.addMessage(userMessage(id, 1), [
      file('photo.png', 'png', 'image/png', PNG),
    ]);
    await conversationService.addMessage(userMessage(id, 2), [
      file('later.pdf', 'pdf', 'application/pdf', PDF),
    ]);

    const fork = await conversationService.fork(id, 1);
    const [copy] = await conversationService.getMessages(fork.id);
    expect(copy.id).not.toBe(source.id);
    const rows = await conversationService.getAttachments(fork.id);
    // Only the files of the copied message
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      messageId: copy.id,
      conversationId: fork.id,
      name: 'photo.png',
    });
    expect(rows[0].id).not.toBe(source.attachments![0].id);
    expect(copy.attachments).toEqual([{ ...source.attachments![0], id: rows[0].id }]);
    expect(bytesOf(rows[0].data)).toEqual(PNG);

    // The source keeps its own rows
    expect(await conversationService.getAttachments(id)).toHaveLength(2);
    await conversationService.delete(fork.id);
    expect(await conversationService.getAttachments(id)).toHaveLength(2);
  });

  it('over the cap (browser estimate) saves the text and the metadata only', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      storage: { estimate: async () => ({ usage: ATTACHMENT_STORAGE_CAP, quota: 10 ** 12 }) },
    });
    const { id } = await conversationService.create();
    const saved = await conversationService.addMessage(userMessage(id, 1, 'keep this text'), [
      file('photo.png', 'png', 'image/png', PNG),
    ]);

    expect(saved.attachments).toEqual([
      { id: expect.any(String), name: 'photo.png', format: 'png', sizeBytes: 8, kept: false },
    ]);
    const [stored] = await conversationService.getMessages(id);
    expect(stored.content).toBe('keep this text');
    expect(stored.attachments?.[0].kept).toBe(false);
    expect(await db.attachments.count()).toBe(0);
  });

  it('over the cap (sum of the kept files in the message metadata, no estimate) saves the metadata only', async () => {
    const { id } = await conversationService.create();
    // A message whose metadata says that its kept file fills the cap (no row: the bytes are never read)
    await db.messages.add({
      ...userMessage('other', 1),
      id: 'm0',
      attachments: [
        {
          id: 'big',
          name: 'big.pdf',
          format: 'pdf',
          sizeBytes: ATTACHMENT_STORAGE_CAP,
          kept: true,
        },
      ],
    });
    const each = vi.spyOn(db.attachments, 'each');
    const toArray = vi.spyOn(db.attachments, 'toArray');
    const saved = await conversationService.addMessage(userMessage(id, 1), [
      file('photo.png', 'png', 'image/png', PNG),
    ]);
    expect(saved.attachments?.[0].kept).toBe(false);
    expect(await conversationService.getAttachments(id)).toEqual([]);
    expect(each).not.toHaveBeenCalled();
    expect(toArray).not.toHaveBeenCalled();
  });

  it('without an estimate, a file that was not kept does not count', async () => {
    const { id } = await conversationService.create();
    await db.messages.add({
      ...userMessage('other', 1),
      id: 'm0',
      attachments: [
        {
          id: 'big',
          name: 'big.pdf',
          format: 'pdf',
          sizeBytes: ATTACHMENT_STORAGE_CAP,
          kept: false,
        },
      ],
    });
    const saved = await conversationService.addMessage(userMessage(id, 1), [
      file('photo.png', 'png', 'image/png', PNG),
    ]);
    expect(saved.attachments?.[0].kept).toBe(true);
  });

  const expectTextKept = async (error: unknown) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.attachments, 'bulkAdd').mockImplementation(() => Dexie.Promise.reject(error));
    const { id } = await conversationService.create();
    const saved = await conversationService.addMessage(userMessage(id, 1, 'still here'), [
      file('photo.png', 'png', 'image/png', PNG),
    ]);

    expect(saved.attachments?.[0].kept).toBe(false);
    const stored = await conversationService.getMessages(id);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('still here');
    expect(stored[0].attachments?.[0].kept).toBe(false);
    expect((await conversationService.get(id))?.messageCount).toBe(1);
    expect(await db.attachments.count()).toBe(0);
    return log;
  };

  it('on a QuotaExceededError of the put request (a Dexie BulkError) keeps the text', async () => {
    const quota = new DOMException('q', 'QuotaExceededError');
    const log = await expectTextKept(new Dexie.BulkError('x', { 0: quota }));
    // The log has the error name only, never the value
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0].join(' ')).toContain('BulkError');
    expect(log.mock.calls[0].every((arg) => typeof arg === 'string')).toBe(true);
  });

  it('on a quota failure at commit time (AbortError with the quota inside) keeps the text', async () => {
    await expectTextKept(new Dexie.AbortError('x', new DOMException('q', 'QuotaExceededError')));
  });

  it('on any other failure of the file write (a DataCloneError) keeps the text', async () => {
    const log = await expectTextKept(new DOMException('could not clone', 'DataCloneError'));
    expect(log.mock.calls[0].join(' ')).toContain('DataCloneError');
    expect(log.mock.calls[0].join(' ')).not.toContain('could not clone');
  });

  it('rethrows when the write without the files also fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.attachments, 'bulkAdd').mockImplementation(() =>
      Dexie.Promise.reject(new DOMException('q', 'DataCloneError'))
    );
    const add = db.messages.add.bind(db.messages);
    let calls = 0;
    vi.spyOn(db.messages, 'add').mockImplementation((...args) => {
      calls += 1;
      return calls === 1 ? add(...args) : Dexie.Promise.reject(new Error('disk gone'));
    });
    const { id } = await conversationService.create();
    await expect(
      conversationService.addMessage(userMessage(id, 1), [
        file('photo.png', 'png', 'image/png', PNG),
      ])
    ).rejects.toThrow('disk gone');
    expect(await conversationService.getMessages(id)).toEqual([]);
  });

  it('keeps the metadata of a file that has no bytes (sent again after it was not kept)', async () => {
    const { id } = await conversationService.create();
    const saved = await conversationService.addMessage(userMessage(id, 1), [
      { name: 'lost.pdf', format: 'pdf', mediaType: 'application/pdf', size: 2048 },
      file('photo.png', 'png', 'image/png', PNG),
    ]);
    expect(saved.attachments?.map((a) => [a.name, a.sizeBytes, a.kept])).toEqual([
      ['lost.pdf', 2048, false],
      ['photo.png', 8, true],
    ]);
    expect((await conversationService.getAttachments(id)).map((row) => row.name)).toEqual([
      'photo.png',
    ]);
  });
});
