import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTextContent } from '../../types/ai-messages';
import { useBedrockChat } from '../useBedrockChat';

const addMessageMock = vi.hoisted(() =>
  vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'saved-1' }))
);

// The hook loads a conversation and persists messages through these hooks.
vi.mock('../index', () => ({
  useConversation: () => ({ conversation: undefined, messages: undefined, isLoading: false }),
  useConversationMutations: () => ({
    createConversation: vi.fn(async () => ({ id: 'conv-1' })),
    addMessage: addMessageMock,
    getNextSequence: vi.fn(async () => 1),
    deleteMessagesFromSequence: vi.fn(async () => 0),
    forkConversation: vi.fn(),
    setMessageFeedback: vi.fn(),
  }),
}));

// Only imported for the mantle provider path, not exercised here.
vi.mock('../../services', () => ({ mantleService: { getApiKey: () => '', getRegion: () => '' } }));

const model = { id: 'anthropic.claude', name: 'Claude', provider: 'bedrock' as const };

const options = {
  conversationId: null,
  selectedModel: model,
  maxTokens: 4096,
  maxToolSteps: 10,
  thinkingEffort: 'default' as const,
  enableWebSearch: false,
};

const encoder = new TextEncoder();
const chunk = (content: string) => encoder.encode(`data: ${JSON.stringify({ content })}\n`);

const lastAssistant = (messages: { role: string; parts: unknown[] }[]) => {
  const msg = [...messages].reverse().find((m) => m.role === 'assistant');
  return msg ? getTextContent(msg as never) : '';
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('useBedrockChat streaming', () => {
  it('updates the message at most once per animation frame and keeps the full text', async () => {
    // A frame that never comes while the stream runs: every chunk arrives within one frame
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const chunkCount = 600;
    const chunks = Array.from({ length: chunkCount }, (_, i) => chunk(`${i % 10}`));
    const expected = chunks.map((_, i) => `${i % 10}`).join('');
    let i = 0;
    const reader = {
      read: vi.fn(async () =>
        i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }
      ),
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: { getReader: () => reader },
    })) as never;

    const assistantSnapshots: string[] = [];
    const { result } = renderHook(() => {
      const chat = useBedrockChat(options);
      assistantSnapshots.push(lastAssistant(chat.messages));
      return chat;
    });

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    // One frame was asked for and never ran, so the 600 chunks reached state once, at the end
    // (the other change is the user message appearing)
    expect(frames).toHaveLength(1);
    expect(lastAssistant(result.current.messages)).toBe(expected);
    const changes = assistantSnapshots.filter((t, idx) => t !== assistantSnapshots[idx - 1]).length;
    expect(changes).toBeLessThanOrEqual(2);
  });

  it('keeps the text received so far when aborted mid-stream', async () => {
    const early = [chunk('a'), chunk('b'), chunk('c')];
    let i = 0;
    let abortSignal: AbortSignal | undefined;
    const reader = {
      read: vi.fn(async () => {
        if (i < early.length) return { done: false, value: early[i++] };
        // Hang until the stream is aborted, then reject like a real fetch reader.
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        });
      }),
    };
    globalThis.fetch = vi.fn(async (_url: string, opts: { signal: AbortSignal }) => {
      abortSignal = opts.signal;
      return { ok: true, body: { getReader: () => reader } };
    }) as never;

    const { result } = renderHook(() => useBedrockChat(options));

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('hello');
    });

    // Wait until the three chunks are read and the fourth read is pending.
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(4));

    act(() => {
      result.current.stopGeneration();
    });
    await act(async () => {
      await sendPromise;
    });

    expect(lastAssistant(result.current.messages)).toBe('abc');
    expect(result.current.status).toBe('idle');
  });

  it('keeps the usage event on the reply, with the model that wrote it', async () => {
    const usage = {
      inputTokens: 2400,
      outputTokens: 250,
      totalTokens: 2650,
      steps: [
        { inputTokens: 1000, outputTokens: 50 },
        { inputTokens: 1400, outputTokens: 200 },
      ],
    };
    const lines = [
      chunk('Answer'),
      encoder.encode(`data: ${JSON.stringify({ metadata: { usage, latencyMs: 2100 } })}\n`),
    ];
    let i = 0;
    const reader = {
      read: vi.fn(async () =>
        i < lines.length ? { done: false, value: lines[i++] } : { done: true, value: undefined }
      ),
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: { getReader: () => reader },
    })) as never;

    const { result } = renderHook(() => useBedrockChat(options));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    const reply = result.current.messages.find((m) => m.role === 'assistant');
    expect(reply?.usage).toEqual({ ...usage, latencyMs: 2100 });
    expect(reply?.model).toEqual({ provider: 'bedrock', id: 'anthropic.claude' });
  });

  it('stores tool calls with the reply, marks a failed tool, and closes one left open', async () => {
    const event = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n`);
    const lines = [
      event({ reasoning: 'plan' }),
      event({ toolCall: { id: 'a', name: 'webSearch', args: { query: 'q' } } }),
      event({ toolResult: { id: 'a', result: { provider: 'brave', results: [] } } }),
      event({ toolCall: { id: 'b', name: 'fetch', args: { url: 'https://a.test' } } }),
      event({ toolResult: { id: 'b', name: 'fetch', error: 'Connection refused' } }),
      event({ toolCall: { id: 'c', name: 'fetch', args: { url: 'https://b.test' } } }),
      chunk('Answer'),
    ];
    let i = 0;
    const reader = {
      read: vi.fn(async () =>
        i < lines.length ? { done: false, value: lines[i++] } : { done: true, value: undefined }
      ),
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: { getReader: () => reader },
    })) as never;
    addMessageMock.mockClear();

    const { result } = renderHook(() => useBedrockChat(options));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    const reply = result.current.messages.find((m) => m.role === 'assistant');
    const statuses = reply?.parts
      .filter((p) => p.type === 'tool-call')
      .map((p) => (p as { status: string }).status);
    expect(statuses).toEqual(['complete', 'error', 'error']);

    const stored = addMessageMock.mock.calls
      .map(([input]) => input)
      .find((input) => input.role === 'assistant') as { toolCalls: Array<Record<string, unknown>> };
    expect(stored.toolCalls).toHaveLength(3);
    expect(stored.toolCalls[1]).toMatchObject({ status: 'error', result: 'Connection refused' });
    expect(stored.toolCalls[2]).toMatchObject({ status: 'error' });
    expect(stored.toolCalls[0]).not.toHaveProperty('type');
  });
});
