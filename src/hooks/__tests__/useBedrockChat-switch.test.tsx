/**
 * The open chat's messages with the real database (#98, #99, #130): a switch never shows the
 * previous chat's messages, and a rating of a reply with no row is not reported as saved.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import { conversationService } from '../../services/conversationService';
import { getTextContent } from '../../types/ai-messages';
import { replyStore } from '../../utils/replyStore';
import { useBedrockChat } from '../useBedrockChat';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('../../services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services')>()),
  mantleService: { getApiKey: () => '', getRegion: () => '' },
}));
vi.mock('../../services/replyNotices', () => ({ notifyReply: vi.fn(async () => {}) }));

const model = { id: 'anthropic.claude', name: 'Claude', provider: 'bedrock' as const };

async function chatWith(...contents: string[]): Promise<string> {
  const { id } = await conversationService.create();
  for (const [i, content] of contents.entries()) {
    await conversationService.addMessage({
      conversationId: id,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content,
      sequence: i + 1,
      createdAt: new Date(),
      provider: 'bedrock',
      modelId: model.id,
      modelName: model.name,
    });
  }
  return id;
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

const texts = (messages: Parameters<typeof getTextContent>[0][]) => messages.map(getTextContent);

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  replyStore.clear();
  await db.conversations.clear();
  await db.messages.clear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('useBedrockChat with the real database', () => {
  it('shows no message of the previous chat in the first render after a switch', async () => {
    const a = await chatWith('question in a', 'answer in a');
    const b = await chatWith('only in b');
    const { result, rerender } = renderChat(a);
    await waitFor(() => expect(texts(result.current.messages)).toHaveLength(2));

    rerender({ conversationId: b });
    expect(texts(result.current.messages)).not.toContain('question in a');
    expect(texts(result.current.messages)).not.toContain('answer in a');
    await waitFor(() => expect(texts(result.current.messages)).toEqual(['only in b']));
  });

  it('shows an empty chat as empty', async () => {
    const a = await chatWith('question in a', 'answer in a');
    const empty = await chatWith();
    const { result, rerender } = renderChat(a);
    await waitFor(() => expect(texts(result.current.messages)).toHaveLength(2));

    rerender({ conversationId: empty });
    // Let the live query of the empty chat return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(result.current.messages).toEqual([]);
  });

  it('does not say "Feedback saved" for a stopped reply that has no row', async () => {
    const a = await chatWith('question in a', 'answer in a');
    let signal!: AbortSignal;
    let sent = false;
    globalThis.fetch = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      let i = 0;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (i++ === 0) {
                sent = true;
                return { done: false, value: encoder.encode('data: {"content":"partial"}\n') };
              }
              return new Promise((_resolve, reject) => {
                if (signal.aborted) reject(new DOMException('aborted', 'AbortError'));
                signal.addEventListener('abort', () =>
                  reject(new DOMException('aborted', 'AbortError'))
                );
              });
            },
          }),
        },
      };
    }) as never;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (cb) => setTimeout(() => cb(0), 0) as unknown as number
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderChat(a);
    await waitFor(() => expect(texts(result.current.messages)).toHaveLength(2));
    let send!: Promise<void>;
    act(() => {
      send = result.current.sendMessage('next');
    });
    await waitFor(() => expect(sent).toBe(true));
    await waitFor(() => expect(getTextContent(result.current.messages.at(-1)!)).toBe('partial'));
    act(() => result.current.stopGeneration());
    await act(async () => {
      await send;
    });

    const shown = result.current.messages.at(-1)!;
    expect(shown.role).toBe('assistant');
    expect(await db.messages.get(shown.id)).toBeUndefined();
    await act(async () => {
      await result.current.rateMessage(shown.id, 'helpful');
    });
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('Could not save feedback');
    expect(result.current.messages.at(-1)?.feedback).toBeUndefined();
  });
});
