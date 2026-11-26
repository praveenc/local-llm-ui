import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../../db/types';
import { getTextContent } from '../../types/ai-messages';
import { replyStore } from '../../utils/replyStore';
import { useBedrockChat } from '../useBedrockChat';

// The database of the test: messages per chat. A write makes a new array, as a live query does.
const db = vi.hoisted(() => ({ messages: {} as Record<string, Message[]> }));
const addMessageMock = vi.hoisted(() => vi.fn());
const notifyReply = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../index', () => ({
  useConversation: (id: string | null) => ({
    conversation: undefined,
    messages: id ? db.messages[id] : undefined,
    isLoading: false,
  }),
  useConversationMutations: () => ({
    createConversation: vi.fn(async () => ({ id: 'new-1' })),
    addMessage: addMessageMock,
    getNextSequence: vi.fn(async (id: string) => (db.messages[id]?.length ?? 0) + 1),
    deleteMessagesFromSequence: vi.fn(async () => 0),
    forkConversation: vi.fn(),
    setMessageFeedback: vi.fn(),
  }),
}));

vi.mock('../../services', () => ({ mantleService: { getApiKey: () => '', getRegion: () => '' } }));
vi.mock('../../services/replyNotices', () => ({ notifyReply }));

const model = { id: 'anthropic.claude', name: 'Claude', provider: 'bedrock' as const };

const dbMessage = (
  conversationId: string,
  sequence: number,
  role: 'user' | 'assistant',
  content: string
): Message =>
  ({
    id: `${conversationId}-${sequence}`,
    conversationId,
    role,
    content,
    sequence,
    createdAt: new Date(0),
  }) as Message;

const encoder = new TextEncoder();

/** One reply stream that the test feeds chunk by chunk */
interface Stream {
  push(content: string): void;
  end(): void;
  signal: AbortSignal;
}

let streams: Stream[] = [];

function mockFetch() {
  globalThis.fetch = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
    let wake: (() => void) | null = null;
    const signal = init.signal;
    const reader = {
      read: async () => {
        while (queue.length === 0) {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
        return queue.shift()!;
      },
    };
    const feed = (item: { done: boolean; value?: Uint8Array }) => {
      queue.push(item);
      wake?.();
    };
    streams.push({
      push: (content) =>
        feed({ done: false, value: encoder.encode(`data: ${JSON.stringify({ content })}\n`) }),
      end: () => feed({ done: true }),
      signal,
    });
    return { ok: true, body: { getReader: () => reader } };
  }) as never;
}

const lastAssistant = (messages: { role: string; parts: unknown[] }[]) => {
  const msg = [...messages].reverse().find((m) => m.role === 'assistant');
  return msg ? getTextContent(msg as never) : '';
};

function renderChat(id: string | null) {
  return renderHook(
    ({ conversationId }: { conversationId: string | null }) =>
      useBedrockChat({
        conversationId,
        selectedModel: model,
        maxTokens: 1024,
        maxToolSteps: 10,
        thinkingEffort: 'default',
      }),
    { initialProps: { conversationId: id } }
  );
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  streams = [];
  db.messages = {
    A: [dbMessage('A', 1, 'user', 'earlier in A'), dbMessage('A', 2, 'assistant', 'answer in A')],
    B: [dbMessage('B', 1, 'user', 'only in B'), dbMessage('B', 2, 'assistant', 'reply in B')],
  };
  addMessageMock.mockReset();
  addMessageMock.mockImplementation(async (input: Omit<Message, 'id'>) => {
    const saved = { ...input, id: `${input.conversationId}-${input.sequence}` } as Message;
    db.messages[input.conversationId] = [...(db.messages[input.conversationId] ?? []), saved];
    return saved;
  });
  notifyReply.mockClear();
  // A frame runs on the next task, so the stream loop can keep going between frames
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb) => setTimeout(() => cb(0), 0) as unknown as number
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => clearTimeout(handle));
  mockFetch();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const savedReplies = (id: string) =>
  addMessageMock.mock.calls
    .map(([input]) => input as Message)
    .filter((m) => m.conversationId === id && m.role === 'assistant')
    .map((m) => m.content);

describe('useBedrockChat with replies in the background', () => {
  it('keeps a reply in its own chat when another chat opens, and saves it there', async () => {
    const { result, rerender } = renderChat('A');
    let send!: Promise<void>;
    act(() => {
      send = result.current.sendMessage('count');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => streams[0].push('one '));
    await waitFor(() => expect(lastAssistant(result.current.messages)).toBe('one '));

    rerender({ conversationId: 'B' });
    expect(result.current.messages.map((m) => getTextContent(m))).toEqual([
      'only in B',
      'reply in B',
    ]);
    expect(result.current.status).toBe('idle');

    act(() => {
      streams[0].push('two');
      streams[0].end();
    });
    await act(async () => {
      await send;
    });

    // Chat B did not change; chat A got the whole reply
    expect(lastAssistant(result.current.messages)).toBe('reply in B');
    expect(savedReplies('A')).toEqual(['one two']);
    expect(savedReplies('B')).toEqual([]);
    expect(notifyReply).toHaveBeenCalledWith('A', 'done');
    // It ended off screen: chat A reads the saved reply from the database when it opens
    expect(replyStore.get('A')).toBeUndefined();
    rerender({ conversationId: 'A' });
    expect(lastAssistant(result.current.messages)).toBe('one two');
    expect(result.current.status).toBe('idle');
  });

  it('shows the reply live when its chat opens again while it runs', async () => {
    const { result, rerender } = renderChat('A');
    let send!: Promise<void>;
    act(() => {
      send = result.current.sendMessage('count');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    rerender({ conversationId: 'B' });
    act(() => streams[0].push('while away'));
    await waitFor(() =>
      expect(replyStore.get('A') && lastAssistant(replyStore.get('A')!.messages)).toBe('while away')
    );

    rerender({ conversationId: 'A' });
    expect(result.current.status).toBe('streaming');
    expect(lastAssistant(result.current.messages)).toBe('while away');

    act(() => streams[0].end());
    await act(async () => {
      await send;
    });
    expect(result.current.status).toBe('idle');
    expect(lastAssistant(result.current.messages)).toBe('while away');
    // notifyReply decides on the toast and the Open action (replyNotices.test.ts)
    expect(notifyReply).toHaveBeenCalledWith('A', 'done');
    expect(replyStore.get('A')?.status).toBe('idle');
  });

  it('runs two chats at once, and Stop stops only the open chat', async () => {
    const { result, rerender } = renderChat('A');
    let sendA!: Promise<void>;
    act(() => {
      sendA = result.current.sendMessage('long one');
    });
    await waitFor(() => expect(streams).toHaveLength(1));

    rerender({ conversationId: 'B' });
    // The send button is Stop only in a chat with a running reply: B can send
    expect(result.current.status).toBe('idle');
    let sendB!: Promise<void>;
    act(() => {
      sendB = result.current.sendMessage('in B');
    });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(replyStore.isRunning('A')).toBe(true);
    expect(replyStore.isRunning('B')).toBe(true);

    act(() => streams[1].push('partial B'));
    await waitFor(() => expect(lastAssistant(result.current.messages)).toBe('partial B'));
    act(() => result.current.stopGeneration());
    await act(async () => {
      await sendB;
    });
    expect(streams[1].signal.aborted).toBe(true);
    expect(streams[0].signal.aborted).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.wasInterrupted).toBe(true);
    expect(lastAssistant(result.current.messages)).toBe('partial B');
    expect(notifyReply).not.toHaveBeenCalledWith('B', expect.anything());

    act(() => {
      streams[0].push('A done');
      streams[0].end();
    });
    await act(async () => {
      await sendA;
    });
    expect(savedReplies('A')).toEqual(['A done']);
  });

  it('starts an empty new chat during a reply, and the reply ends in its own chat', async () => {
    const onConversationChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | null }) =>
        useBedrockChat({
          conversationId,
          selectedModel: model,
          maxTokens: 1024,
          maxToolSteps: 10,
          thinkingEffort: 'default',
          onConversationChange,
        }),
      { initialProps: { conversationId: 'A' as string | null } }
    );
    let send!: Promise<void>;
    act(() => {
      send = result.current.sendMessage('count');
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => streams[0].push('one '));
    await waitFor(() => expect(lastAssistant(result.current.messages)).toBe('one '));

    // New chat, as AppShell does it
    act(() => result.current.clearMessages());
    rerender({ conversationId: null });
    expect(onConversationChange).toHaveBeenLastCalledWith(null);
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('idle');

    act(() => {
      streams[0].push('two');
      streams[0].end();
    });
    await act(async () => {
      await send;
    });
    expect(result.current.messages).toEqual([]);
    expect(savedReplies('A')).toEqual(['one two']);
    expect(notifyReply).toHaveBeenCalledWith('A', 'done');
  });

  it('ends a failed reply in its own chat and keeps the error there', async () => {
    const { result, rerender } = renderChat('A');
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Server down',
    })) as never;
    rerender({ conversationId: 'B' });
    rerender({ conversationId: 'A' });
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Server down');
    expect(notifyReply).toHaveBeenCalledWith('A', 'failed');

    // Leaving the chat drops the ended entry
    rerender({ conversationId: 'B' });
    expect(replyStore.get('A')).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
