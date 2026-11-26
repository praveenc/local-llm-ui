import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import type { Conversation } from '../../db/types';
import { kiroService } from '../../services/kiro';
import { loadPreferences, savePreferences } from '../../utils/preferences';
import {
  NEW_CHAT_KEY,
  clearPendingSessionOptions,
  movePendingSessionOptions,
  pendingSessionOptions,
  useSessionOptions,
} from '../useSessionOptions';

const SESSION = 'sess_00000000-0000-4000-8000-000000000042';

const lists = {
  mode: {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: 'agent-a',
    values: [
      { value: 'agent-a', name: 'Agent A' },
      { value: 'agent-b', name: 'Agent B' },
    ],
  },
  options: [],
};

/** Kiro's lists reach the service through the models response, as in the app */
async function loadLists(sessionOptions: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ models: [], sessionOptions }),
    })
  );
  await kiroService.getModels();
}

const setDefaultAgent = (agent: string | undefined) =>
  savePreferences({ ...loadPreferences(), kiroDefaultAgent: agent });

const chat = (kiro: Conversation['kiro']): Conversation => ({
  id: 'conv-d9',
  title: 'Chat',
  createdAt: new Date(),
  updatedAt: new Date(),
  status: 'active',
  messageCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  providers: ['kiro'],
  models: ['claude-haiku-5.5'],
  kiro,
});

beforeEach(async () => {
  localStorage.clear();
  await db.conversations.clear();
  await loadLists(lists);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  for (const key of [NEW_CHAT_KEY, 'conv-d9', 'conv-new']) clearPendingSessionOptions(key);
});

describe('useSessionOptions default agent (D9)', () => {
  it('a new chat shows the default agent from Preferences', () => {
    setDefaultAgent('agent-b');
    const { result } = renderHook(() => useSessionOptions(null));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-b');
  });

  it("a new chat shows Kiro's own default when no agent is set", () => {
    const { result } = renderHook(() => useSessionOptions(null));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a');
  });

  it('follows a change in Preferences at once', () => {
    const { result } = renderHook(() => useSessionOptions(null));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a');
    act(() => setDefaultAgent('agent-b'));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-b');
    act(() => setDefaultAgent(undefined));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a');
  });

  it('ignores an agent that Kiro does not list', () => {
    setDefaultAgent('agent-gone');
    const { result } = renderHook(() => useSessionOptions(null));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a');
  });

  it("a pick of Kiro's own default stays a pick, and wins over the default agent", () => {
    setDefaultAgent('agent-b');
    const { result } = renderHook(() => useSessionOptions(null));
    act(() => result.current.pick('mode', 'agent-a'));
    expect(pendingSessionOptions(NEW_CHAT_KEY)).toEqual({ mode: 'agent-a' });
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a');
    // Picking the agent that the chat shows without a pick leaves nothing to send
    act(() => result.current.pick('mode', 'agent-b'));
    expect(pendingSessionOptions(NEW_CHAT_KEY)).toBeUndefined();
  });

  it('an existing chat keeps its own agent', async () => {
    setDefaultAgent('agent-b');
    await db.conversations.add(
      chat({ sessionId: SESSION, seenMessages: 2, options: { mode: 'agent-a' } })
    );
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a'));
    // An imported chat with no stored agent shows Kiro's own value, not the default
    await db.conversations.update('conv-d9', { kiro: { sessionId: SESSION, seenMessages: 2 } });
    await waitFor(() => expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a'));
  });

  it('shows no lists when Kiro lists none', async () => {
    await loadLists(undefined);
    setDefaultAgent('agent-b');
    const { result } = renderHook(() => useSessionOptions(null));
    expect(result.current.snapshot).toBeNull();
  });
});

describe('movePendingSessionOptions with a default agent (D9)', () => {
  it('moves the default agent to the conversation that the first message makes', () => {
    setDefaultAgent('agent-b');
    movePendingSessionOptions(NEW_CHAT_KEY, 'conv-new');
    expect(pendingSessionOptions('conv-new')).toEqual({ mode: 'agent-b' });
  });

  it("puts the user's picks over the default agent", () => {
    setDefaultAgent('agent-b');
    const { result } = renderHook(() => useSessionOptions(null));
    act(() => result.current.pick('mode', 'agent-a'));
    movePendingSessionOptions(NEW_CHAT_KEY, 'conv-new');
    expect(pendingSessionOptions('conv-new')).toEqual({ mode: 'agent-a' });
    expect(pendingSessionOptions(NEW_CHAT_KEY)).toBeUndefined();
  });

  it('moves nothing for an agent that Kiro does not list', () => {
    setDefaultAgent('agent-gone');
    movePendingSessionOptions(NEW_CHAT_KEY, 'conv-new');
    expect(pendingSessionOptions('conv-new')).toBeUndefined();
  });

  it('moves nothing without a preference, or when no lists are loaded (not Kiro)', async () => {
    movePendingSessionOptions(NEW_CHAT_KEY, 'conv-new');
    expect(pendingSessionOptions('conv-new')).toBeUndefined();

    await loadLists(undefined);
    setDefaultAgent('agent-b');
    movePendingSessionOptions(NEW_CHAT_KEY, 'conv-new');
    expect(pendingSessionOptions('conv-new')).toBeUndefined();
  });

  it('gives no default to a move from a chat that exists', () => {
    setDefaultAgent('agent-b');
    movePendingSessionOptions('conv-d9', 'conv-new');
    expect(pendingSessionOptions('conv-new')).toBeUndefined();
  });
});
