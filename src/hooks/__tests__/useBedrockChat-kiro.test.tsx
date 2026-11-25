import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, Message } from '../../db/types';
import type { ToolCallPart } from '../../types/ai-messages';
import type { ChatModel } from '../useBedrockChat';
import { useBedrockChat } from '../useBedrockChat';

const SESSION = 'sess_00000000-0000-4000-8000-000000000001';

const db = vi.hoisted(() => ({
  conversation: undefined as Conversation | undefined,
  messages: [] as Message[],
}));

const mutations = vi.hoisted(() => ({
  createConversation: vi.fn(async () => ({ id: 'conv-1' })),
  addMessage: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'saved-1' })),
  getNextSequence: vi.fn(async () => 1),
  deleteMessagesFromSequence: vi.fn(async () => 0),
  forkConversation: vi.fn(),
  setMessageFeedback: vi.fn(),
  getConversation: vi.fn(async () => db.conversation),
  getMessages: vi.fn(async () => db.messages),
  setKiroSession: vi.fn(async () => {}),
  setTitleFromKiro: vi.fn(async () => {}),
}));

vi.mock('../index', () => ({
  useConversation: () => ({ conversation: undefined, messages: undefined, isLoading: false }),
  useConversationMutations: () => mutations,
}));

vi.mock('../../services', () => ({ mantleService: { getApiKey: () => '', getRegion: () => '' } }));

const opus: ChatModel = {
  id: 'claude-opus-5.5',
  name: 'Claude Opus 5.5',
  provider: 'kiro',
  supportsThinking: true,
  kiro: { effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], rateMultiplier: 2 },
};

const options = (overrides: Partial<Parameters<typeof useBedrockChat>[0]> = {}) => ({
  conversationId: null,
  selectedModel: opus,
  maxTokens: 4096,
  maxToolSteps: 10,
  thinkingEffort: 'default' as const,
  enableWebSearch: true,
  ...overrides,
});

const encoder = new TextEncoder();
const event = (value: unknown) =>
  encoder.encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);

/**
 * A fetch that answers with these SSE events. `hold` stops the stream before that event until
 * `release()`; after the last event, a held stream waits for an abort.
 */
function mockKiroFetch(events: unknown[], hold?: { before: number }) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signal: AbortSignal | undefined;
  let i = 0;
  const reader = {
    read: vi.fn(async () => {
      if (hold && i === hold.before && i < events.length) await gate;
      if (i < events.length) return { done: false, value: event(events[i++]) };
      if (hold && hold.before >= events.length) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        });
      }
      return { done: true, value: undefined };
    }),
  };
  const fetchMock = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    signal = init.signal;
    return { ok: true, body: { getReader: () => reader } };
  });
  globalThis.fetch = fetchMock as never;
  return { fetchMock, reader, release: () => release() };
}

const requestOf = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return { url, body: JSON.parse(init.body) as Record<string, unknown> };
};

const dbMessage = (sequence: number, role: 'user' | 'assistant', content: string): Message => ({
  id: `m${sequence}`,
  conversationId: 'conv-1',
  role,
  content,
  sequence,
  createdAt: new Date(),
  provider: 'bedrock',
  modelId: 'claude',
  modelName: 'Claude',
});

const originalFetch = globalThis.fetch;
beforeEach(() => {
  db.conversation = undefined;
  db.messages = [];
  vi.clearAllMocks();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useBedrockChat with Kiro', () => {
  it('sends the first message with no history, and stores the session and the usage', async () => {
    const { fetchMock } = mockKiroFetch([
      { session: { id: SESSION, created: true } },
      { content: 'Hello' },
      { metadata: { usage: { credits: 0.05, contextPercent: 3 }, latencyMs: 2900 } },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options({ thinkingEffort: 'max' })));

    await act(async () => {
      await result.current.sendMessage('hi', [{ name: 'a.txt', format: 'txt', bytes: 'eA==' }]);
    });

    const { url, body } = requestOf(fetchMock);
    expect(url).toBe('/api/kiro/chat');
    expect(body).toEqual({
      seenMessages: 0,
      history: [],
      prompt: 'hi',
      model: 'claude-opus-5.5',
      thinkingEffort: 'max',
    });
    // No files, web search, MCP servers, max tokens, or tool steps for Kiro
    expect(JSON.stringify(body)).not.toMatch(/files|enableWebSearch|mcpServers|max_tokens|maxTool/);

    expect(mutations.setKiroSession).toHaveBeenNthCalledWith(1, 'conv-1', {
      sessionId: SESSION,
      seenMessages: 0,
    });
    // After the reply: Kiro has seen the new message and its reply
    expect(mutations.setKiroSession).toHaveBeenLastCalledWith('conv-1', {
      sessionId: SESSION,
      seenMessages: 2,
    });

    const reply = mutations.addMessage.mock.calls.find(([m]) => m.role === 'assistant')?.[0];
    expect(reply).toMatchObject({
      provider: 'kiro',
      content: 'Hello',
      parameters: { thinkingEffort: 'max' },
      usage: { credits: 0.05, contextPercent: 3, latencyMs: 2900 },
    });
    expect(reply?.parameters).not.toHaveProperty('maxTokens');
    expect(result.current.messages.at(-1)?.usage).toMatchObject({ credits: 0.05 });
    // The user message has no file part
    expect(result.current.messages[0].parts.map((p) => p.type)).toEqual(['text']);
  });

  it('sends the earlier messages and what the session has seen for a later message', async () => {
    db.conversation = {
      id: 'conv-1',
      kiro: { sessionId: SESSION, seenMessages: 2 },
    } as Conversation;
    db.messages = [
      dbMessage(1, 'user', 'first'),
      dbMessage(2, 'assistant', '<think>hmm</think>\nanswer'),
      dbMessage(3, 'user', '   '),
    ];
    const { fetchMock } = mockKiroFetch([
      { session: { id: SESSION, created: false } },
      { content: 'ok' },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options({ conversationId: 'conv-1' })));

    await act(async () => {
      await result.current.sendMessage('second');
    });

    expect(requestOf(fetchMock).body).toEqual({
      sessionId: SESSION,
      seenMessages: 2,
      // The answer without its thinking; messages without text are left out
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
      ],
      prompt: 'second',
      model: 'claude-opus-5.5',
    });
    expect(mutations.setKiroSession).toHaveBeenNthCalledWith(1, 'conv-1', {
      sessionId: SESSION,
      seenMessages: 2,
    });
    expect(mutations.setKiroSession).toHaveBeenLastCalledWith('conv-1', {
      sessionId: SESSION,
      seenMessages: 4,
    });
  });

  it('starts counting again when the server opens a new session', async () => {
    db.conversation = {
      id: 'conv-1',
      kiro: { sessionId: SESSION, seenMessages: 9 },
    } as Conversation;
    db.messages = [dbMessage(1, 'user', 'a'), dbMessage(2, 'assistant', 'b')];
    const fresh = 'sess_00000000-0000-4000-8000-000000000002';
    mockKiroFetch([{ session: { id: fresh, created: true } }, { content: 'ok' }, '[DONE]']);
    const { result } = renderHook(() => useBedrockChat(options({ conversationId: 'conv-1' })));

    await act(async () => {
      await result.current.sendMessage('c');
    });

    expect(mutations.setKiroSession).toHaveBeenNthCalledWith(1, 'conv-1', {
      sessionId: fresh,
      seenMessages: 0,
    });
    expect(mutations.setKiroSession).toHaveBeenLastCalledWith('conv-1', {
      sessionId: fresh,
      seenMessages: 4,
    });
  });

  it("passes Kiro's title on to the conversation", async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      { title: 'Weather in Seattle' },
      { content: 'Sunny' },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('weather?');
    });
    expect(mutations.setTitleFromKiro).toHaveBeenCalledWith('conv-1', 'Weather in Seattle');
  });

  it('shows the status text until the first output, and does not store it', async () => {
    const { release } = mockKiroFetch(
      [
        { status: 'Starting Kiro…' },
        { session: { id: SESSION, created: true } },
        { content: 'Hi' },
        '[DONE]',
      ],
      { before: 1 }
    );
    const { result } = renderHook(() => useBedrockChat(options()));

    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('hi');
    });
    await waitFor(() => expect(result.current.streamStatus).toBe('Starting Kiro…'));

    await act(async () => {
      release();
      await sending;
    });
    expect(result.current.streamStatus).toBeNull();
    const reply = mutations.addMessage.mock.calls.find(([m]) => m.role === 'assistant')?.[0];
    expect(JSON.stringify(reply)).not.toContain('Starting Kiro');
  });

  it('counts the new message as seen after Stop, once the session is known', async () => {
    const { reader } = mockKiroFetch(
      [{ session: { id: SESSION, created: true } }, { content: 'Part' }],
      { before: 2 }
    );
    const { result } = renderHook(() => useBedrockChat(options()));

    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('hi');
    });
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(3));
    act(() => result.current.stopGeneration());
    await act(async () => {
      await sending;
    });

    expect(mutations.setKiroSession).toHaveBeenLastCalledWith('conv-1', {
      sessionId: SESSION,
      seenMessages: 1,
    });
    // The partial reply is not stored
    expect(mutations.addMessage.mock.calls.some(([m]) => m.role === 'assistant')).toBe(false);
  });

  it('leaves the seen count as the session event set it after an error', async () => {
    db.conversation = {
      id: 'conv-1',
      kiro: { sessionId: SESSION, seenMessages: 2 },
    } as Conversation;
    db.messages = [dbMessage(1, 'user', 'a'), dbMessage(2, 'assistant', 'b')];
    mockKiroFetch([
      { session: { id: SESSION, created: false } },
      { error: 'Kiro stopped' },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options({ conversationId: 'conv-1' })));

    await act(async () => {
      await result.current.sendMessage('c');
    });

    expect(result.current.error).toBe('Kiro stopped');
    expect(mutations.setKiroSession).toHaveBeenCalledTimes(1);
    expect(mutations.setKiroSession).toHaveBeenCalledWith('conv-1', {
      sessionId: SESSION,
      seenMessages: 2,
    });
  });

  it('stores a tool error with no question as failed, with the reason', async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      { toolCall: { id: 't1', name: 'run_command', args: { command: 'ls' } } },
      { toolResult: { id: 't1', name: 'run_command', error: 'Command failed' } },
      { content: 'I could not run it.' },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('list files');
    });

    const reply = mutations.addMessage.mock.calls.find(([m]) => m.role === 'assistant')?.[0];
    expect(reply?.toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: 't1',
        toolName: 'run_command',
        status: 'error',
        result: 'Command failed',
      }),
    ]);
    expect((reply?.toolCalls as unknown[] | undefined)?.[0]).not.toHaveProperty('approvals');
  });

  it('sends only a thinking effort that the model offers', async () => {
    const { fetchMock } = mockKiroFetch([{ content: 'ok' }, '[DONE]']);
    const noMax: ChatModel = { ...opus, kiro: { effortLevels: ['low', 'medium', 'high'] } };
    const { result } = renderHook(() =>
      useBedrockChat(options({ selectedModel: noMax, thinkingEffort: 'max' }))
    );
    await act(async () => {
      await result.current.sendMessage('hi');
    });
    expect(requestOf(fetchMock).body).not.toHaveProperty('thinkingEffort');
  });

  it('does not count a reply with no text as seen, as the next history leaves it out', async () => {
    db.conversation = {
      id: 'conv-1',
      kiro: { sessionId: SESSION, seenMessages: 2 },
    } as Conversation;
    db.messages = [dbMessage(1, 'user', 'a'), dbMessage(2, 'assistant', 'b')];
    mockKiroFetch([
      { session: { id: SESSION, created: false } },
      { reasoning: 'hmm' },
      { toolCall: { id: 't1', name: 'read', args: { path: 'a.ts' } } },
      { toolResult: { id: 't1', name: 'read', result: 'x' } },
      { content: '   ' },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options({ conversationId: 'conv-1' })));

    await act(async () => {
      await result.current.sendMessage('c');
    });

    // The chat (2) and the new message; not the reply, which has no text
    expect(mutations.setKiroSession).toHaveBeenLastCalledWith('conv-1', {
      sessionId: SESSION,
      seenMessages: 3,
    });
  });

  it('leaves the Kiro record as it was after a Stop before the session event', async () => {
    db.conversation = {
      id: 'conv-1',
      kiro: { sessionId: SESSION, seenMessages: 2 },
    } as Conversation;
    db.messages = [dbMessage(1, 'user', 'a'), dbMessage(2, 'assistant', 'b')];
    const { reader } = mockKiroFetch([{ status: 'Starting Kiro…' }], { before: 1 });
    const { result } = renderHook(() => useBedrockChat(options({ conversationId: 'conv-1' })));

    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('c');
    });
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(2));
    act(() => result.current.stopGeneration());
    await act(async () => {
      await sending;
    });

    expect(mutations.setKiroSession).not.toHaveBeenCalled();
  });

  it('counts the chat and the new message after a Stop that follows the session event', async () => {
    db.conversation = {
      id: 'conv-1',
      kiro: { sessionId: SESSION, seenMessages: 2 },
    } as Conversation;
    db.messages = [dbMessage(1, 'user', 'a'), dbMessage(2, 'assistant', 'b')];
    const { reader } = mockKiroFetch([{ session: { id: SESSION, created: false } }], {
      before: 1,
    });
    const { result } = renderHook(() => useBedrockChat(options({ conversationId: 'conv-1' })));

    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('c');
    });
    // The session event came; the stream then waits
    await waitFor(() => expect(mutations.setKiroSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(2));
    act(() => result.current.stopGeneration());
    await act(async () => {
      await sending;
    });
    // history.length (2) + the new message
    expect(mutations.setKiroSession).toHaveBeenLastCalledWith('conv-1', {
      sessionId: SESSION,
      seenMessages: 3,
    });
  });

  it('clears the status text on the session event', async () => {
    const { release } = mockKiroFetch(
      [
        { status: 'Starting Kiro…' },
        { session: { id: SESSION, created: true } },
        { content: 'Hi' },
      ],
      { before: 2 }
    );
    const { result } = renderHook(() => useBedrockChat(options()));

    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('hi');
    });
    // The session event came; the content is held back
    await waitFor(() =>
      expect(mutations.setKiroSession).toHaveBeenCalledWith('conv-1', {
        sessionId: SESSION,
        seenMessages: 0,
      })
    );
    expect(result.current.streamStatus).toBeNull();

    await act(async () => {
      release();
      await sending;
    });
  });

  it('regenerates a reply of another provider with the user message once', async () => {
    const bedrock: ChatModel = { id: 'anthropic.claude', name: 'Claude', provider: 'bedrock' };
    const { result } = renderHook(() => useBedrockChat(options({ selectedModel: bedrock })));

    mockKiroFetch([{ content: 'first answer' }, '[DONE]']);
    await act(async () => {
      await result.current.sendMessage('question');
    });
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    const { fetchMock } = mockKiroFetch([{ content: 'second answer' }, '[DONE]']);
    mutations.addMessage.mockClear();
    await act(async () => {
      await result.current.regenerate(1);
    });

    // The user row goes too (sequence 1), so sendMessage adds it back once
    expect(mutations.deleteMessagesFromSequence).toHaveBeenLastCalledWith('conv-1', 1);
    const body = requestOf(fetchMock).body as { messages: { role: string; content: string }[] };
    expect(body.messages).toEqual([expect.objectContaining({ role: 'user', content: 'question' })]);
    expect(mutations.addMessage.mock.calls.filter(([m]) => m.role === 'user')).toHaveLength(1);
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('useBedrockChat with Kiro questions', () => {
  const R1 = '00000000-0000-4000-8000-00000000000a';
  const R2 = '00000000-0000-4000-8000-00000000000b';
  const shellOptions = [
    { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
    { optionId: 'reject_always', name: 'Always deny', kind: 'reject_always' },
  ];
  const shellCall = { toolCall: { id: 't1', name: 'shell', args: { command: 'echo hi' } } };
  const shellQuestion = {
    permission: {
      requestId: R1,
      toolCallId: 't1',
      title: 'echo hi',
      command: 'echo hi',
      options: shellOptions,
    },
  };

  const toolParts = (messages: { parts: unknown[] }[]) =>
    (messages.at(-1)?.parts ?? []).filter(
      (p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call'
    );
  const storedReply = () =>
    mutations.addMessage.mock.calls.find(([m]) => m.role === 'assistant')?.[0] as
      { toolCalls?: unknown[] } | undefined;

  it('puts the question on its tool call, open, until its result ends it', async () => {
    const { reader, release } = mockKiroFetch(
      [
        { session: { id: SESSION, created: true } },
        shellCall,
        shellQuestion,
        {
          permissionResult: {
            requestId: R1,
            optionId: 'reject_once',
            kind: 'reject_once',
            outcome: 'answered',
          },
        },
        { toolResult: { id: 't1', name: 'shell', error: 'The user rejected it' } },
        { content: 'Not run.' },
        '[DONE]',
      ],
      { before: 3 }
    );
    const { result } = renderHook(() => useBedrockChat(options()));
    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('run it');
    });
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(toolParts(result.current.messages)[0]?.approvals).toBeDefined());
    expect(toolParts(result.current.messages)[0].approvals).toEqual([
      { requestId: R1, state: 'open', title: 'echo hi', command: 'echo hi', options: shellOptions },
    ]);

    release();
    await act(async () => {
      await sending;
    });
    expect(toolParts(result.current.messages)[0].approvals).toEqual([
      { requestId: R1, state: 'answered', kind: 'reject_once' },
    ]);
    expect(storedReply()?.toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: 't1',
        status: 'error',
        approvals: [{ requestId: R1, state: 'answered', kind: 'reject_once' }],
      }),
    ]);
  });

  it('puts "Review changes" on the write, and keeps a question that comes before its tool call', async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      {
        permission: {
          requestId: R1,
          toolCallId: 'w1',
          title: 'Write File',
          resource: 'notes.txt',
          options: shellOptions,
        },
      },
      { toolCall: { id: 'w1', name: 'write', args: { path: 'notes.txt' } } },
      {
        permissionResult: {
          requestId: R1,
          optionId: 'allow_once',
          kind: 'allow_once',
          outcome: 'answered',
        },
      },
      {
        permission: {
          requestId: R2,
          toolCallId: 'turn_approval_1',
          title: 'Review changes',
          review: true,
          relatedToolCallIds: ['w1'],
          options: [
            { optionId: 'accept', name: 'Accept changes', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject changes', kind: 'reject_once' },
          ],
        },
      },
      {
        permissionResult: {
          requestId: R2,
          optionId: 'accept',
          kind: 'allow_once',
          outcome: 'answered',
        },
      },
      { toolResult: { id: 'w1', name: 'write', result: 'ok' } },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('write it');
    });

    const parts = toolParts(result.current.messages);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ toolCallId: 'w1', toolName: 'write', status: 'complete' });
    expect(parts[0].approvals).toEqual([
      { requestId: R1, state: 'answered', kind: 'allow_once' },
      { requestId: R2, state: 'answered', kind: 'allow_once', review: true },
    ]);
  });

  it('gives a question with no known tool call a line of its own', async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      {
        permission: {
          requestId: R1,
          toolCallId: 'turn_approval_9',
          title: 'Review changes',
          review: true,
          relatedToolCallIds: ['gone'],
          options: shellOptions,
        },
      },
      { permissionResult: { requestId: R1, outcome: 'timeout' } },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('x');
    });
    const parts = toolParts(result.current.messages);
    expect(parts).toEqual([
      expect.objectContaining({
        toolCallId: 'turn_approval_9',
        toolName: 'Review changes',
        approvals: [{ requestId: R1, state: 'not-answered', review: true }],
      }),
    ]);
  });

  it('ends an open question as not answered when the stream ends without its result', async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      shellCall,
      shellQuestion,
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('run it');
    });
    expect(toolParts(result.current.messages)[0].approvals).toEqual([
      { requestId: R1, state: 'not-answered' },
    ]);
    expect(storedReply()?.toolCalls).toEqual([
      expect.objectContaining({ approvals: [{ requestId: R1, state: 'not-answered' }] }),
    ]);
  });

  it('ends an open question as not answered after Stop', async () => {
    const { reader } = mockKiroFetch(
      [{ session: { id: SESSION, created: true } }, shellCall, shellQuestion],
      { before: 3 }
    );
    const { result } = renderHook(() => useBedrockChat(options()));
    let sending: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('run it');
    });
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(4));
    act(() => result.current.stopGeneration());
    await act(async () => {
      await sending;
    });
    expect(result.current.status).toBe('idle');
    expect(toolParts(result.current.messages)[0].approvals).toEqual([
      { requestId: R1, state: 'not-answered' },
    ]);
  });

  it('ends an open question as not answered after a stream error', async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      shellCall,
      shellQuestion,
      { error: 'Kiro stopped' },
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('run it');
    });
    expect(result.current.error).toBe('Kiro stopped');
    expect(toolParts(result.current.messages)[0].approvals).toEqual([
      { requestId: R1, state: 'not-answered' },
    ]);
  });

  it('skips a question that is not valid', async () => {
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      shellCall,
      { permission: { requestId: R1, toolCallId: 't1', options: [] } },
      { toolResult: { id: 't1', name: 'shell', result: 'hi' } },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options()));
    await act(async () => {
      await result.current.sendMessage('run it');
    });
    expect(toolParts(result.current.messages)[0]).not.toHaveProperty('approvals');
  });
});
