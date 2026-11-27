/**
 * Stop, then a quick send, in one Kiro chat (Q7): the stopped run still writes the chat's Kiro
 * record after the abort. The new send must read the record after that write, so it sends the
 * right seen count.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, KiroConversationSession, Message } from '../../db/types';
import { WHEN_FINISHED_TIMEOUT_MS, replyStore } from '../../utils/replyStore';
import type { ChatModel } from '../useBedrockChat';
import { useBedrockChat } from '../useBedrockChat';

const SESSION = 'sess_00000000-0000-4000-8000-000000000001';

const db = vi.hoisted(() => ({
  conversation: undefined as Conversation | undefined,
  messages: [] as Message[],
}));

/** The Kiro write of the stopped run waits for this gate */
const gate = vi.hoisted(() => ({ open: () => {}, wait: Promise.resolve() }));

const mutations = vi.hoisted(() => ({
  createConversation: vi.fn(async () => ({ id: 'conv-1' })),
  addMessage: vi.fn(),
  getNextSequence: vi.fn(async () => db.messages.length + 1),
  deleteMessagesFromSequence: vi.fn(async () => 0),
  forkConversation: vi.fn(),
  setMessageFeedback: vi.fn(),
  getConversation: vi.fn(async () => db.conversation),
  getMessages: vi.fn(async () => db.messages),
  setKiroSession: vi.fn(),
  setTitleFromKiro: vi.fn(async () => {}),
}));

vi.mock('../index', () => ({
  useConversation: () => ({ conversation: undefined, messages: undefined, isLoading: false }),
  useConversationMutations: () => mutations,
}));

vi.mock('../../services', () => ({ mantleService: { getApiKey: () => '', getRegion: () => '' } }));
// The real check, watched: a send that a Stop ends during the wait must not call it
const prepareKiroSend = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../services/kiroSyncs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/kiroSyncs')>();
  return {
    ...actual,
    prepareKiroSend: (...args: Parameters<typeof actual.prepareKiroSend>) => {
      prepareKiroSend.calls++;
      return actual.prepareKiroSend(...args);
    },
  };
});
vi.mock('../../services/replyNotices', () => ({ notifyReply: vi.fn(async () => {}) }));

const opus: ChatModel = { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'kiro' };

const encoder = new TextEncoder();
const event = (value: unknown) =>
  encoder.encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);

/**
 * Each call answers with the next list of events; `hold` waits for an abort after them. With
 * `failOnAbort` the abort ends the stream with a network error, not an AbortError.
 */
function mockFetch(answers: Array<{ events: unknown[]; hold?: boolean; failOnAbort?: boolean }>) {
  let call = 0;
  const fetchMock = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    const { events, hold, failOnAbort } = answers[call++];
    const abortError = () =>
      failOnAbort ? new TypeError('network error') : new DOMException('aborted', 'AbortError');
    let i = 0;
    const reader = {
      read: vi.fn(async () => {
        if (i < events.length) return { done: false, value: event(events[i++]) };
        if (hold) {
          return new Promise((_resolve, reject) => {
            if (init.signal.aborted) reject(abortError());
            init.signal.addEventListener('abort', () => reject(abortError()));
          });
        }
        return { done: true, value: undefined };
      }),
    };
    return { ok: true, body: { getReader: () => reader } };
  });
  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, n: number) =>
  JSON.parse((fetchMock.mock.calls[n] as [string, { body: string }])[1].body) as {
    seenMessages: number;
    history: unknown[];
  };

const dbMessage = (sequence: number, role: 'user' | 'assistant', content: string): Message => ({
  id: `m${sequence}`,
  conversationId: 'conv-1',
  role,
  content,
  sequence,
  createdAt: new Date(),
  provider: 'kiro',
  modelId: 'claude-opus-5.5',
  modelName: 'Claude Opus 5.5',
});

const originalFetch = globalThis.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  replyStore.clear();
  prepareKiroSend.calls = 0;
  db.conversation = { id: 'conv-1', kiro: { sessionId: SESSION, seenMessages: 2 } } as Conversation;
  db.messages = [dbMessage(1, 'user', 'a'), dbMessage(2, 'assistant', 'b')];
  gate.wait = new Promise<void>((resolve) => {
    gate.open = resolve;
  });
  mutations.addMessage.mockImplementation(async (input: Omit<Message, 'id'>) => {
    const saved = { ...input, id: `m${input.sequence}` } as Message;
    db.messages = [...db.messages, saved];
    return saved;
  });
  // The session event's write is quick; the stopped run's write after the abort is slow
  mutations.setKiroSession.mockImplementation(
    async (_id: string, kiro: KiroConversationSession) => {
      if (mutations.setKiroSession.mock.calls.length === 2) await gate.wait;
      db.conversation = { ...db.conversation!, kiro };
    }
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderKiroChat() {
  return renderHook(() =>
    useBedrockChat({
      conversationId: 'conv-1',
      selectedModel: opus,
      maxTokens: 4096,
      maxToolSteps: 10,
      thinkingEffort: 'default',
    })
  );
}

/** Sends, waits for the session event's write, stops, and waits for the stopped run's write */
async function sendAndStop(result: ReturnType<typeof renderKiroChat>['result']) {
  let first!: Promise<void>;
  act(() => {
    first = result.current.sendMessage('c');
  });
  await waitFor(() => expect(mutations.setKiroSession).toHaveBeenCalledTimes(1));
  act(() => result.current.stopGeneration());
  await waitFor(() => expect(mutations.setKiroSession).toHaveBeenCalledTimes(2));
  expect(result.current.status).toBe('idle');
  // In an object: an async function that returns the promise would wait for it
  return { first };
}

describe('useBedrockChat: Stop, then send, in a Kiro chat', () => {
  it('reads the Kiro record after the stopped run wrote it', async () => {
    const fetchMock = mockFetch([
      { events: [{ session: { id: SESSION, created: false } }], hold: true },
      { events: [{ session: { id: SESSION, created: false } }, { content: 'ok' }, '[DONE]'] },
    ]);
    const { result } = renderHook(() =>
      useBedrockChat({
        conversationId: 'conv-1',
        selectedModel: opus,
        maxTokens: 4096,
        maxToolSteps: 10,
        thinkingEffort: 'default',
      })
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.sendMessage('c');
    });
    await waitFor(() => expect(mutations.setKiroSession).toHaveBeenCalledTimes(1));
    act(() => result.current.stopGeneration());
    // The stopped run now writes its record (seen: a, b, c), slowly
    await waitFor(() => expect(mutations.setKiroSession).toHaveBeenCalledTimes(2));
    expect(result.current.status).toBe('idle');

    let second!: Promise<void>;
    act(() => {
      second = result.current.sendMessage('d');
    });
    // The new send waits for the write before it reads the record and sends
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.open();
      await first;
      await second;
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // a, b, and c: what the stopped run's write says Kiro has seen
    expect(bodyOf(fetchMock, 1).seenMessages).toBe(3);
  });

  it('sends after the time limit when the stopped run never finishes', async () => {
    const fetchMock = mockFetch([
      { events: [{ session: { id: SESSION, created: false } }], hold: true },
      { events: [{ session: { id: SESSION, created: false } }, { content: 'ok' }, '[DONE]'] },
    ]);
    const { result } = renderKiroChat();
    const { first } = await sendAndStop(result);

    vi.useFakeTimers();
    let second!: Promise<void>;
    act(() => {
      second = result.current.sendMessage('d');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WHEN_FINISHED_TIMEOUT_MS - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prepareKiroSend.calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
    await act(async () => {
      await second;
    });
    // The stopped run's write is still held: the record says a and b
    expect(bodyOf(fetchMock, 1).seenMessages).toBe(2);
    await act(async () => {
      gate.open();
      await first;
    });
  });

  it('ends a send that Stop stops during the wait, without the Kiro check', async () => {
    const fetchMock = mockFetch([
      { events: [{ session: { id: SESSION, created: false } }], hold: true },
    ]);
    const { result } = renderKiroChat();
    const { first } = await sendAndStop(result);
    expect(prepareKiroSend.calls).toBe(1);

    let second!: Promise<void>;
    act(() => {
      second = result.current.sendMessage('d');
    });
    expect(result.current.status).toBe('submitted');
    act(() => result.current.stopGeneration());
    expect(result.current.status).toBe('idle');
    await act(async () => {
      gate.open();
      await first;
      await second;
    });
    expect(prepareKiroSend.calls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mutations.getConversation).toHaveBeenCalledTimes(1);
    expect(replyStore.isRunning('conv-1')).toBe(false);
  });

  it('waits for a stopped run that ends on the error path', async () => {
    const fetchMock = mockFetch([
      {
        // An event after the session event: Kiro started, so the error path writes the record
        events: [{ session: { id: SESSION, created: false } }, { content: 'part' }],
        hold: true,
        failOnAbort: true,
      },
      { events: [{ session: { id: SESSION, created: false } }, { content: 'ok' }, '[DONE]'] },
    ]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderKiroChat();
    const { first } = await sendAndStop(result);
    // The error path's write: the turn count is unknown now
    expect(mutations.setKiroSession.mock.calls[1][1]).toMatchObject({
      seenMessages: 3,
      turns: undefined,
    });

    let second!: Promise<void>;
    act(() => {
      second = result.current.sendMessage('d');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.open();
      await first;
      await second;
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).seenMessages).toBe(3);
  });
});
