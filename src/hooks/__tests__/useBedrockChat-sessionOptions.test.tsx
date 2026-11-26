import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, KiroConversationSession, Message } from '../../db/types';
import { kiroService } from '../../services/kiro';
import type { SessionOptionsSnapshot } from '../../utils/sessionOptions';
import type { ChatModel } from '../useBedrockChat';
import { useBedrockChat } from '../useBedrockChat';
import {
  NEW_CHAT_KEY,
  clearPendingSessionOptions,
  pendingSessionOptions,
  setPendingSessionOption,
} from '../useSessionOptions';

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

const service = vi.hoisted(() => ({ setKiroSessionOptions: vi.fn(async () => {}) }));

vi.mock('../index', () => ({
  useConversation: () => ({ conversation: undefined, messages: undefined, isLoading: false }),
  useConversationMutations: () => mutations,
}));
vi.mock('../../services/conversationService', () => ({ conversationService: service }));
vi.mock('../../services', () => ({ mantleService: { getApiKey: () => '', getRegion: () => '' } }));

/** A stored chat with this Kiro record; the hook reads only these fields */
const chatWith = (kiro: KiroConversationSession) => ({ id: 'conv-1', kiro }) as Conversation;

const haiku: ChatModel = { id: 'claude-haiku-5.5', name: 'Claude Haiku 5.5', provider: 'kiro' };

const options = (conversationId: string | null) => ({
  conversationId,
  selectedModel: haiku,
  maxTokens: 4096,
  maxToolSteps: 10,
  thinkingEffort: 'default' as const,
});

const snapshot = (agent: string, autopilot: string): SessionOptionsSnapshot => ({
  mode: {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: agent,
    values: [
      { value: 'agent-a', name: 'Agent A' },
      { value: 'agent-b', name: 'Agent B' },
    ],
  },
  options: [
    {
      id: 'autopilot',
      name: 'Autopilot',
      currentValue: autopilot,
      values: [
        { value: 'on', name: 'Autopilot' },
        { value: 'off', name: 'Supervised' },
      ],
    },
  ],
});

const encoder = new TextEncoder();
function mockKiroFetch(events: unknown[]) {
  let i = 0;
  const reader = {
    read: vi.fn(async () =>
      i < events.length
        ? {
            done: false,
            value: encoder.encode(
              `data: ${typeof events[i] === 'string' ? events[i++] : JSON.stringify(events[i++])}\n`
            ),
          }
        : { done: true, value: undefined }
    ),
  };
  const fetchMock = vi.fn(async () => ({ ok: true, body: { getReader: () => reader } }));
  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as Record<
    string,
    unknown
  >;

const dbMessage = (sequence: number, role: 'user' | 'assistant', content: string): Message => ({
  id: `m${sequence}`,
  conversationId: 'conv-1',
  role,
  content,
  sequence,
  createdAt: new Date(),
  provider: 'kiro',
  modelId: 'claude-haiku-5.5',
  modelName: 'Claude Haiku 5.5',
});

beforeEach(() => {
  db.conversation = undefined;
  db.messages = [];
  vi.clearAllMocks();
  clearPendingSessionOptions(NEW_CHAT_KEY);
  clearPendingSessionOptions('conv-1');
});

describe('useBedrockChat with Kiro session options', () => {
  it('sends the picks of a new chat, then stores the values that the session reports', async () => {
    setPendingSessionOption(NEW_CHAT_KEY, 'mode', 'agent-b', 'agent-a');
    setPendingSessionOption(NEW_CHAT_KEY, 'autopilot', 'off', 'on');
    const fetchMock = mockKiroFetch([
      { session: { id: SESSION, created: true } },
      { sessionOptions: snapshot('agent-b', 'off') },
      { content: 'pong' },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options(null)));
    await act(async () => {
      await result.current.sendMessage('ping');
    });

    expect(bodyOf(fetchMock).sessionOptions).toEqual({ mode: 'agent-b', autopilot: 'off' });
    expect(service.setKiroSessionOptions).toHaveBeenCalledWith('conv-1', SESSION, {
      mode: 'agent-b',
      autopilot: 'off',
    });
    // The lists stay in the tab for the controls; the picks are done
    expect(kiroService.getSessionOptions(SESSION)).toEqual(snapshot('agent-b', 'off'));
    expect(pendingSessionOptions('conv-1')).toBeUndefined();
    expect(pendingSessionOptions(NEW_CHAT_KEY)).toBeUndefined();
  });

  it('sends only the changed picks to the same session, so terminal changes stay', async () => {
    db.conversation = chatWith({
      sessionId: SESSION,
      seenMessages: 0,
      options: { mode: 'agent-a', autopilot: 'on' },
    });
    setPendingSessionOption('conv-1', 'autopilot', 'off', 'on');
    const fetchMock = mockKiroFetch([{ session: { id: SESSION, created: false } }, '[DONE]']);
    const { result } = renderHook(() => useBedrockChat(options('conv-1')));
    await act(async () => {
      await result.current.sendMessage('ping');
    });

    expect(bodyOf(fetchMock).sessionOptions).toEqual({ autopilot: 'off' });
    // The session event keeps the stored values until the session reports new ones
    expect(mutations.setKiroSession).toHaveBeenNthCalledWith(1, 'conv-1', {
      sessionId: SESSION,
      seenMessages: 0,
      options: { mode: 'agent-a', autopilot: 'on' },
    });
    // No snapshot came, so the pick waits for the next message
    expect(pendingSessionOptions('conv-1')).toEqual({ autopilot: 'off' });
  });

  it('sends nothing when the chat has no picks for the same session', async () => {
    db.conversation = chatWith({
      sessionId: SESSION,
      seenMessages: 0,
      options: { autopilot: 'off' },
    });
    const fetchMock = mockKiroFetch(['[DONE]']);
    const { result } = renderHook(() => useBedrockChat(options('conv-1')));
    await act(async () => {
      await result.current.sendMessage('ping');
    });
    expect(bodyOf(fetchMock)).not.toHaveProperty('sessionOptions');
  });

  it('sends the stored values to a new session that replaces a stale one', async () => {
    // The session saw more messages than the chat has now (a regenerate)
    db.conversation = chatWith({
      sessionId: SESSION,
      seenMessages: 4,
      options: { mode: 'agent-b', autopilot: 'off' },
    });
    db.messages = [dbMessage(1, 'user', 'first')];
    const fetchMock = mockKiroFetch(['[DONE]']);
    const { result } = renderHook(() => useBedrockChat(options('conv-1')));
    await act(async () => {
      await result.current.sendMessage('ping');
    });
    expect(bodyOf(fetchMock).sessionOptions).toEqual({ mode: 'agent-b', autopilot: 'off' });
  });

  it('ignores a bad snapshot and keeps the picks', async () => {
    setPendingSessionOption(NEW_CHAT_KEY, 'autopilot', 'off', 'on');
    mockKiroFetch([
      { session: { id: SESSION, created: true } },
      { sessionOptions: { options: [{ id: 'autopilot' }] } },
      '[DONE]',
    ]);
    const { result } = renderHook(() => useBedrockChat(options(null)));
    await act(async () => {
      await result.current.sendMessage('ping');
    });
    expect(service.setKiroSessionOptions).not.toHaveBeenCalled();
    expect(pendingSessionOptions('conv-1')).toEqual({ autopilot: 'off' });
  });
});
