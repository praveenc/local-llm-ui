/**
 * Attached files with the real database (#102, D-E, D-G): the bytes survive leaving the chat,
 * regenerate sends them again, and earlier files past the request budget go as a text line.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { db } from '../../db';
import { conversationService } from '../../services/conversationService';
import type { FilePart } from '../../types/ai-messages';
import { bytesToBase64 } from '../../types/ai-messages';
import type { UIMessage } from '../../types/ai-messages';
import { replyStore } from '../../utils/replyStore';
import {
  REQUEST_BUDGET,
  REQUEST_LIMIT,
  buildChatMessages,
  useBedrockChat,
} from '../useBedrockChat';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services')>()),
  mantleService: { getApiKey: () => '', getRegion: () => '' },
}));
vi.mock('../../services/replyNotices', () => ({ notifyReply: vi.fn(async () => {}) }));

const model = { id: 'anthropic.claude', name: 'Claude', provider: 'bedrock' as const };
const PNG = bytesToBase64(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer);

type SentMessage = {
  role: string;
  content: string;
  files: Array<{ name: string; format: string; bytes: string }>;
};

// The test database (fake-indexeddb) clones values with Node's structuredClone, so a stored
// ArrayBuffer comes back from Node's realm. Dexie's live query cache copies a buffer of another
// realm as an empty object, and the chat would see no bytes. A browser's IndexedDB returns the
// page's own ArrayBuffer, so the test makes the clone return this realm's buffers.
const nodeClone = globalThis.structuredClone;
const isObject = (value: unknown) => Object.prototype.toString.call(value) === '[object Object]';
const sameRealm = (value: unknown): unknown => {
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return new Uint8Array(value as ArrayBuffer).slice().buffer;
  }
  if (Array.isArray(value)) return value.map(sameRealm);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, sameRealm(v)]));
  }
  return value;
};
globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) =>
  sameRealm(nodeClone(value, options))) as typeof structuredClone;
afterAll(() => {
  globalThis.structuredClone = nodeClone;
});

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

/** A Bedrock reply "ok" for every request; the request bodies in order */
function mockReplies(): SentMessage[][] {
  const bodies: SentMessage[][] = [];
  globalThis.fetch = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push((JSON.parse(init.body) as { messages: SentMessage[] }).messages);
    const chunks = ['data: {"content":"ok"}\n', 'data: [DONE]\n'];
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            chunks.length
              ? { done: false, value: encoder.encode(chunks.shift()!) }
              : { done: true, value: undefined },
        }),
      },
    };
  }) as never;
  return bodies;
}

function renderChat(id: string) {
  return renderHook(
    ({ conversationId }: { conversationId: string | null }) =>
      useBedrockChat({
        conversationId,
        selectedModel: model,
        maxTokens: 1024,
        maxToolSteps: 10,
        thinkingEffort: 'default',
      }),
    { initialProps: { conversationId: id as string | null } }
  );
}

const filesOf = (message: { parts: Array<{ type: string }> }) =>
  message.parts.filter((p): p is FilePart => p.type === 'file');

beforeEach(async () => {
  replyStore.clear();
  await conversationService.clearAll();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb) => setTimeout(() => cb(0), 0) as unknown as number
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// These tests encode about 10 MB of files. They take about 0.5 s alone, and more than the
// default 5 s when the whole suite runs on a busy host.
const LARGE_FILE_TIMEOUT = 20_000;

describe('useBedrockChat files', () => {
  it('sends a PNG again after the chat was left and opened again', async () => {
    const bodies = mockReplies();
    const { id } = await conversationService.create();
    const other = await conversationService.create();
    const { result, rerender } = renderChat(id);

    await act(async () => {
      await result.current.sendMessage('what is this', [
        { name: 'photo.png', format: 'png', bytes: PNG },
      ]);
    });
    expect(bodies[0][0].files).toEqual([{ name: 'photo.png', format: 'png', bytes: PNG }]);

    // Leave the chat (its ended reply is dismissed) and open it again: it reads the database
    rerender({ conversationId: other.id });
    rerender({ conversationId: id });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(filesOf(result.current.messages[0])).toEqual([
      { type: 'file', filename: 'photo.png', mediaType: 'image/png', size: 8, data: PNG },
    ]);

    await act(async () => {
      await result.current.sendMessage('and now?');
    });
    expect(bodies[1][0].files).toEqual([{ name: 'photo.png', format: 'png', bytes: PNG }]);
    expect(bodies[1][2]).toMatchObject({ content: 'and now?', files: [] });
  });

  it('an only-files send stores and sends empty text, with the file', async () => {
    const bodies = mockReplies();
    const { id } = await conversationService.create();
    const { result } = renderChat(id);

    await act(async () => {
      await result.current.sendMessage('', [{ name: 'photo.png', format: 'png', bytes: PNG }]);
    });
    expect(bodies[0][0]).toEqual({
      role: 'user',
      content: '',
      files: [{ name: 'photo.png', format: 'png', bytes: PNG }],
    });
    const stored = await db.messages.where('conversationId').equals(id).sortBy('sequence');
    expect(stored[0].content).toBe('');
    expect((await conversationService.get(id))?.title).toBe('New Conversation');
  });

  it('sends an earlier PDF as a text line to a Groq model and counts it', async () => {
    const bodies = mockReplies();
    localStorage.setItem('local-llm-ui-preferences', JSON.stringify({ groqApiKey: 'test-key' }));
    onTestFinished(() => localStorage.clear());
    const { id } = await conversationService.create();
    const { result, rerender } = renderHook(
      ({
        selectedModel,
      }: {
        selectedModel: { id: string; name: string; provider: 'bedrock' | 'groq' };
      }) =>
        useBedrockChat({
          conversationId: id,
          selectedModel,
          maxTokens: 1024,
          maxToolSteps: 10,
          thinkingEffort: 'default',
        }),
      {
        initialProps: {
          selectedModel: model as { id: string; name: string; provider: 'bedrock' | 'groq' },
        },
      }
    );
    await act(async () => {
      await result.current.sendMessage('read', [{ name: 'a.pdf', format: 'pdf', bytes: PNG }]);
    });
    rerender({ selectedModel: { id: 'gpt-oss', name: 'gpt-oss', provider: 'groq' } });
    await act(async () => {
      await result.current.sendMessage('and now?');
    });
    expect(bodies[1][0]).toEqual({
      role: 'user',
      content: 'read\n\n[Earlier file: a.pdf]',
      files: [],
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(4));
    expect(result.current.messages[3].filesNotResent).toBe(1);
  });

  it('regenerate sends the file of the user message again and keeps it stored', async () => {
    const bodies = mockReplies();
    const { id } = await conversationService.create();
    const other = await conversationService.create();
    const { result, rerender } = renderChat(id);
    await act(async () => {
      await result.current.sendMessage('describe', [
        { name: 'photo.png', format: 'png', bytes: PNG },
      ]);
    });
    rerender({ conversationId: other.id });
    rerender({ conversationId: id });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    await act(async () => {
      await result.current.regenerate(1);
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toHaveLength(1);
    expect(bodies[1][0]).toMatchObject({
      content: 'describe',
      files: [{ name: 'photo.png', format: 'png', bytes: PNG }],
    });
    const rows = await conversationService.getAttachments(id);
    expect(rows).toHaveLength(1);
    const [user] = await conversationService.getMessages(id);
    expect(rows[0].messageId).toBe(user.id);
  });

  it(
    'sends the oldest earlier file as a text line past the budget, and says so',
    async () => {
      const bodies = mockReplies();
      const { id } = await conversationService.create();
      // Two earlier files whose base64 together is over the budget
      const big = (fill: number) =>
        new Uint8Array(Math.ceil((REQUEST_BUDGET * 0.6 * 3) / 4)).fill(fill);
      const add = (
        sequence: number,
        role: 'user' | 'assistant',
        content: string,
        data?: Uint8Array,
        name?: string
      ) =>
        conversationService.addMessage(
          {
            conversationId: id,
            role,
            content,
            sequence,
            createdAt: new Date(),
            provider: 'bedrock',
            modelId: model.id,
            modelName: model.name,
          },
          data && [
            {
              name: name!,
              format: 'pdf',
              mediaType: 'application/pdf',
              size: data.length,
              data: data.buffer as ArrayBuffer,
            },
          ]
        );
      await add(1, 'user', 'first', big(1), 'old.pdf');
      await add(2, 'assistant', 'one');
      await add(3, 'user', 'second', big(2), 'new.pdf');
      await add(4, 'assistant', 'two');

      const { result } = renderChat(id);
      // Two large files load slowly from fake-indexeddb when the host is busy
      await waitFor(() => expect(result.current.messages).toHaveLength(4), { timeout: 10_000 });
      await act(async () => {
        await result.current.sendMessage('third');
      });

      const [first, , second, , third] = bodies[0];
      expect(first.files).toEqual([]);
      expect(first.content).toBe('first\n\n[Earlier file: old.pdf]');
      expect(second.files.map((f) => f.name)).toEqual(['new.pdf']);
      expect(second.content).toBe('second');
      expect(third.content).toBe('third');
      const base64 = bodies[0].flatMap((m) => m.files).reduce((n, f) => n + f.bytes.length, 0);
      expect(base64).toBeLessThanOrEqual(REQUEST_BUDGET);

      // The reply says that one earlier file was not sent again, also after a reload
      expect(result.current.messages.at(-1)?.filesNotResent).toBe(1);
      const stored = await conversationService.getMessages(id);
      expect(stored.at(-1)).toMatchObject({ role: 'assistant', filesNotResent: 1 });
    },
    LARGE_FILE_TIMEOUT
  );

  it('sends a file that was not kept as a text line, with its name', async () => {
    const bodies = mockReplies();
    const { id } = await conversationService.create();
    await db.messages.add({
      id: 'u1',
      conversationId: id,
      role: 'user',
      content: 'look',
      sequence: 1,
      createdAt: new Date(),
      provider: 'bedrock',
      modelId: model.id,
      modelName: model.name,
      attachments: [{ id: 'a1', name: 'lost.png', format: 'png', sizeBytes: 9, kept: false }],
    });
    const { result } = renderChat(id);
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(filesOf(result.current.messages[0])[0]).toMatchObject({
      filename: 'lost.png',
      kept: false,
    });

    await act(async () => {
      await result.current.sendMessage('again');
    });
    expect(bodies[0][0]).toEqual({
      role: 'user',
      content: 'look\n\n[Earlier file: lost.png]',
      files: [],
    });
  });

  it('retry after a failed reply sends the file again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { id } = await conversationService.create();
    const failing = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'down' }));
    globalThis.fetch = failing as never;
    const { result } = renderChat(id);
    await act(async () => {
      await result.current.sendMessage('try', [{ name: 'photo.png', format: 'png', bytes: PNG }]);
    });
    expect(result.current.error).toBeTruthy();

    const bodies = mockReplies();
    await act(async () => {
      await result.current.retryLast();
    });
    expect(bodies[0]).toEqual([
      { role: 'user', content: 'try', files: [{ name: 'photo.png', format: 'png', bytes: PNG }] },
    ]);
    expect(await conversationService.getAttachments(id)).toHaveLength(1);
  });

  it('over the storage cap still sends the file, and the message says "not kept"', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      storage: { estimate: async () => ({ usage: 600 * 1024 * 1024, quota: 10 ** 12 }) },
    });
    const bodies = mockReplies();
    const { id } = await conversationService.create();
    const { result } = renderChat(id);
    await act(async () => {
      await result.current.sendMessage('look', [{ name: 'photo.png', format: 'png', bytes: PNG }]);
    });

    expect(bodies[0][0].files).toHaveLength(1);
    expect(filesOf(result.current.messages[0])[0]).toMatchObject({ kept: false, data: PNG });
    expect(await conversationService.getAttachments(id)).toEqual([]);
    const [stored] = await conversationService.getMessages(id);
    expect(stored).toMatchObject({ content: 'look' });
    expect(stored.attachments?.[0]).toMatchObject({ name: 'photo.png', kept: false });
  });
  it(
    'counts long pasted text in the budget, so the whole body stays under the server limit',
    async () => {
      mockReplies();
      const { id } = await conversationService.create();
      // 5 MB of pasted text and a file of 5 MB base64: the files alone fit 8 MB, the body does not
      const pasted = 'x'.repeat(5 * 1024 * 1024);
      const earlier = new Uint8Array((5 * 1024 * 1024 * 3) / 4).fill(3);
      await conversationService.addMessage(
        {
          conversationId: id,
          role: 'user',
          content: pasted,
          sequence: 1,
          createdAt: new Date(),
          provider: 'bedrock',
          modelId: model.id,
          modelName: model.name,
        },
        [
          {
            name: 'old.pdf',
            format: 'pdf',
            mediaType: 'application/pdf',
            size: earlier.length,
            data: earlier.buffer as ArrayBuffer,
          },
        ]
      );
      const newFile = bytesToBase64(new Uint8Array((512 * 1024 * 3) / 4).fill(4).buffer);

      const { result } = renderChat(id);
      // A large earlier file loads slowly from fake-indexeddb when the host is busy
      await waitFor(() => expect(result.current.messages).toHaveLength(1), { timeout: 10_000 });
      await act(async () => {
        await result.current.sendMessage('third', [
          { name: 'new.pdf', format: 'pdf', bytes: newFile },
        ]);
      });

      const body = (vi.mocked(globalThis.fetch).mock.calls[0][1] as { body: string }).body;
      expect(new TextEncoder().encode(body).length).toBeLessThan(REQUEST_LIMIT);
      const { messages } = JSON.parse(body) as { messages: SentMessage[] };
      expect(messages[0].files).toEqual([]);
      expect(messages[0].content.endsWith('\n\n[Earlier file: old.pdf]')).toBe(true);
      // The new message's own file always goes
      expect(messages[1].files.map((f) => f.name)).toEqual(['new.pdf']);
      expect(result.current.messages.at(-1)?.filesNotResent).toBe(1);
    },
    LARGE_FILE_TIMEOUT
  );
});

describe('buildChatMessages', () => {
  const user = (id: string, text: string, files: Partial<FilePart>[] = []): UIMessage => ({
    id,
    role: 'user',
    parts: [
      ...files.map((f) => ({ type: 'file' as const, mediaType: 'application/pdf', ...f })),
      { type: 'text', text },
    ],
  });
  const reply = (id: string): UIMessage => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: 'ok' }],
  });
  const b64 = (mb: number) => 'A'.repeat(Math.round(mb * 1024 * 1024));
  const bodySize = (messages: unknown) =>
    new TextEncoder().encode(JSON.stringify({ messages })).length;

  it('counts the text of the history and of the new message against the earlier files', () => {
    const { chatMessages, filesNotResent } = buildChatMessages([
      user('u1', 'y'.repeat(3 * 1024 * 1024), [{ filename: 'a.pdf', data: b64(3) }]),
      reply('a1'),
      user('u2', 'z'.repeat(3 * 1024 * 1024), [{ filename: 'b.pdf', data: b64(1) }]),
    ]);
    expect(chatMessages[0].files).toEqual([]);
    expect(chatMessages[0].content.endsWith('[Earlier file: a.pdf]')).toBe(true);
    expect(chatMessages[2].files).toHaveLength(1);
    expect(filesNotResent).toBe(1);
    expect(bodySize(chatMessages)).toBeLessThanOrEqual(REQUEST_BUDGET);
  });

  it('never cuts the files of the new message, even past the budget', () => {
    const { chatMessages, filesNotResent } = buildChatMessages([
      user('u1', 'old', [{ filename: 'a.pdf', data: b64(0.1) }]),
      reply('a1'),
      user('u2', 'new', [
        { filename: 'b.pdf', data: b64(5) },
        { filename: 'c.pdf', data: b64(5) },
      ]),
    ]);
    expect(chatMessages[2].files.map((f) => f.name)).toEqual(['b.pdf', 'c.pdf']);
    expect(chatMessages[2].content).toBe('new');
    expect(chatMessages[0].files).toEqual([]);
    expect(filesNotResent).toBe(1);
  });

  it('sends a file of the new message that has no bytes as "File not kept", not as an earlier file', () => {
    const { chatMessages, filesNotResent } = buildChatMessages([
      user('u1', 'again', [{ filename: 'lost.png', mediaType: 'image/png', kept: false }]),
    ]);
    expect(chatMessages[0]).toEqual({
      role: 'user',
      content: 'again\n\n[File not kept: lost.png]',
      files: [],
    });
    expect(filesNotResent).toBe(0);
  });

  it('sends an earlier PDF as a text line when the current model cannot read it', () => {
    const groq = { images: false, pdf: false, office: false, text: true };
    const { chatMessages, filesNotResent } = buildChatMessages(
      [
        user('u1', 'read this', [{ filename: 'a.pdf', data: 'AAAA' }]),
        reply('a1'),
        user('u2', 'and this', [
          { filename: 'notes.md', mediaType: 'text/markdown', data: 'eA==' },
        ]),
      ],
      groq
    );
    expect(chatMessages[0]).toEqual({
      role: 'user',
      content: 'read this\n\n[Earlier file: a.pdf]',
      files: [],
    });
    expect(chatMessages[2].files).toEqual([{ name: 'notes.md', format: 'md', bytes: 'eA==' }]);
    expect(filesNotResent).toBe(1);
  });

  it('sends an earlier image as bytes when the model reads images', () => {
    const { chatMessages, filesNotResent } = buildChatMessages(
      [
        user('u1', 'look', [{ filename: 'p.png', mediaType: 'image/png', data: 'AAAA' }]),
        reply('a1'),
        user('u2', 'again'),
      ],
      { images: true, pdf: true, office: false, text: true }
    );
    expect(chatMessages[0].files).toEqual([{ name: 'p.png', format: 'png', bytes: 'AAAA' }]);
    expect(filesNotResent).toBe(0);
  });

  it('keeps a message with only files', () => {
    const { chatMessages } = buildChatMessages([
      user('u1', '', [{ filename: 'a.pdf', data: 'AAAA' }]),
    ]);
    expect(chatMessages).toEqual([
      { role: 'user', content: '', files: [{ name: 'a.pdf', format: 'pdf', bytes: 'AAAA' }] },
    ]);
  });
});
