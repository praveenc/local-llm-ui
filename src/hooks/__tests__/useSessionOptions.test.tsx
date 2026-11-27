import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import type { Conversation } from '../../db/types';
import { conversationService } from '../../services/conversationService';
import { kiroService } from '../../services/kiro';
import { loadPreferences, savePreferences } from '../../utils/preferences';
import {
  NEW_CHAT_KEY,
  clearPendingSessionOptions,
  forgetPendingSessionOptions,
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
  // Unmount the hooks first: a hook that is still mounted could read its record after the reset
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  forgetPendingSessionOptions();
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

describe('picks that are not sent yet survive a reload (D27)', () => {
  const autopilotLists = {
    ...lists,
    options: [
      {
        id: 'autopilot',
        name: 'Autopilot',
        currentValue: 'on',
        values: [
          { value: 'on', name: 'Autopilot' },
          { value: 'off', name: 'Supervised' },
        ],
      },
    ],
  };
  const storedPicks = async () => (await db.conversations.get('conv-d9'))?.kiroPicks;

  beforeEach(async () => {
    await loadLists(autopilotLists);
    await db.conversations.add(
      chat({ sessionId: SESSION, seenMessages: 2, options: { mode: 'agent-a', autopilot: 'on' } })
    );
  });

  it('stores a pick of an existing chat, and a new hook after a reload shows it', async () => {
    const first = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(first.result.current.snapshot?.mode?.currentValue).toBe('agent-a'));
    act(() => first.result.current.pick('mode', 'agent-b'));
    await waitFor(async () => expect(await storedPicks()).toEqual({ mode: 'agent-b' }));
    first.unmount();

    forgetPendingSessionOptions();
    expect(pendingSessionOptions('conv-d9')).toBeUndefined();
    const second = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(second.result.current.snapshot?.mode?.currentValue).toBe('agent-b'));
    expect(pendingSessionOptions('conv-d9')).toEqual({ mode: 'agent-b' });
  });

  it('drops a stored value that Kiro does not list any more', async () => {
    await db.conversations.update('conv-d9', {
      kiroPicks: { mode: 'agent-gone', autopilot: 'off', removed: 'x' },
    });
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off' }));
    expect(result.current.snapshot?.mode?.currentValue).toBe('agent-a');
    expect(result.current.snapshot?.options[0].currentValue).toBe('off');
    await waitFor(async () => expect(await storedPicks()).toEqual({ autopilot: 'off' }));
  });

  it('clears the stored picks when Kiro applies them', async () => {
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => result.current.pick('autopilot', 'off'));
    await waitFor(async () => expect(await storedPicks()).toEqual({ autopilot: 'off' }));
    act(() => clearPendingSessionOptions('conv-d9'));
    await waitFor(async () => expect(await storedPicks()).toBeUndefined());
    const record = await db.conversations.get('conv-d9');
    expect(record && 'kiroPicks' in record).toBe(false);
    // The hook does not take the old record back after the clear
    expect(pendingSessionOptions('conv-d9')).toBeUndefined();
  });

  it('a clear before the first read wins over the stored picks', async () => {
    await db.conversations.update('conv-d9', { kiroPicks: { autopilot: 'off' } });
    clearPendingSessionOptions('conv-d9');
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(async () => expect(await storedPicks()).toBeUndefined());
    expect(result.current.snapshot?.options[0].currentValue).toBe('on');
  });

  it('moves the picks of a new chat to the conversation that the first message makes', async () => {
    await db.conversations.add({ ...chat(undefined), id: 'conv-new' });
    const { result } = renderHook(() => useSessionOptions(null));
    act(() => result.current.pick('autopilot', 'off'));
    // A new chat has no record: nothing is stored yet
    const all = await db.conversations.toArray();
    expect(all.filter((c) => c.kiroPicks)).toEqual([]);
    movePendingSessionOptions(NEW_CHAT_KEY, 'conv-new');
    await waitFor(async () =>
      expect((await db.conversations.get('conv-new'))?.kiroPicks).toEqual({ autopilot: 'off' })
    );
  });

  it('a delete of the chat deletes its picks', async () => {
    await conversationService.setKiroPicks('conv-d9', { autopilot: 'off' });
    expect(await storedPicks()).toEqual({ autopilot: 'off' });
    await conversationService.delete('conv-d9');
    expect(await db.conversations.get('conv-d9')).toBeUndefined();
    // A late write for the deleted chat makes no record
    await conversationService.setKiroPicks('conv-d9', { autopilot: 'on' });
    expect(await db.conversations.get('conv-d9')).toBeUndefined();
  });

  it("sends and drops nothing from storage while Kiro's lists are not known", async () => {
    await db.conversations.update('conv-d9', { kiroPicks: { autopilot: 'off' } });
    await loadLists(undefined);
    const record = await db.conversations.get('conv-d9');
    expect(pendingSessionOptions('conv-d9', record)).toBeUndefined();
    renderHook(() => useSessionOptions('conv-d9'));
    await new Promise((r) => setTimeout(r, 30));
    // The record keeps the picks for a read with the lists
    expect(await storedPicks()).toEqual({ autopilot: 'off' });
    await act(async () => {
      await loadLists(autopilotLists);
    });
    await waitFor(() => expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off' }));
  });

  it('a pick before the stored picks are read starts from them', async () => {
    await db.conversations.update('conv-d9', { kiroPicks: { autopilot: 'off' } });
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    // At once: the record is not read yet
    act(() => result.current.pick('mode', 'agent-b'));
    await waitFor(async () =>
      expect(await storedPicks()).toEqual({ autopilot: 'off', mode: 'agent-b' })
    );
    expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off', mode: 'agent-b' });
  });

  it('a snapshot clears only the picks whose value it shows; the others stay', async () => {
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => result.current.pick('mode', 'agent-b'));
    act(() => result.current.pick('autopilot', 'off'));
    await waitFor(async () =>
      expect(await storedPicks()).toEqual({ mode: 'agent-b', autopilot: 'off' })
    );
    // The session took the agent, but not Autopilot (a pick made while the reply ran)
    act(() => clearPendingSessionOptions('conv-d9', { mode: 'agent-b', autopilot: 'on' }));
    expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off' });
    await waitFor(async () => expect(await storedPicks()).toEqual({ autopilot: 'off' }));
  });

  it('a snapshot before the tab read the stored picks clears the ones that it shows', async () => {
    await db.conversations.update('conv-d9', { kiroPicks: { mode: 'agent-b', autopilot: 'off' } });
    clearPendingSessionOptions('conv-d9', { mode: 'agent-b', autopilot: 'on' });
    await waitFor(async () => expect(await storedPicks()).toEqual({ autopilot: 'off' }));
    expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off' });
  });

  it('writes the record only when the picks change', async () => {
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => result.current.pick('autopilot', 'off'));
    await waitFor(async () => expect(await storedPicks()).toEqual({ autopilot: 'off' }));
    const write = vi.spyOn(conversationService, 'setKiroPicks');
    // The same pick again, and a snapshot that shows nothing that was picked
    act(() => result.current.pick('autopilot', 'off'));
    act(() => clearPendingSessionOptions('conv-d9', { autopilot: 'on' }));
    expect(write).not.toHaveBeenCalled();
    // A snapshot that shows the pick: one write; then clears of a chat with no picks: none
    act(() => clearPendingSessionOptions('conv-d9', { autopilot: 'off' }));
    expect(write).toHaveBeenCalledTimes(1);
    act(() => clearPendingSessionOptions('conv-d9'));
    act(() => clearPendingSessionOptions('conv-d9', { autopilot: 'off' }));
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });

  it('a pick through the hook, then a delete of the chat, leaves no record', async () => {
    const { result } = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => result.current.pick('autopilot', 'off'));
    await conversationService.delete('conv-d9');
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.conversations.get('conv-d9')).toBeUndefined();
  });

  it('a chat whose record went away is not marked as read, so a later record is read', async () => {
    const old = renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(old.result.current.snapshot).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    forgetPendingSessionOptions();
    await db.conversations.delete('conv-d9');
    await new Promise((r) => setTimeout(r, 50));
    old.unmount();
    await db.conversations.add({
      ...chat({ sessionId: SESSION, seenMessages: 2 }),
      kiroPicks: { autopilot: 'off' },
    });
    renderHook(() => useSessionOptions('conv-d9'));
    await waitFor(() => expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off' }));
  });

  it('a result of the chat that was open before is not taken for the next one', async () => {
    await db.conversations.update('conv-d9', { kiroPicks: { autopilot: 'off' } });
    await db.conversations.add({ ...chat(undefined), id: 'conv-new' });
    const { rerender } = renderHook(({ id }) => useSessionOptions(id), {
      initialProps: { id: 'conv-d9' as string | null },
    });
    await waitFor(() => expect(pendingSessionOptions('conv-d9')).toEqual({ autopilot: 'off' }));
    rerender({ id: 'conv-new' });
    await waitFor(async () =>
      expect((await db.conversations.get('conv-new'))?.id).toBe('conv-new')
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(pendingSessionOptions('conv-new')).toBeUndefined();
  });
});

describe('the agent list of a new chat is loaded again on open (D26)', () => {
  it('a new chat and a chat without a Kiro session ask for the lists; a chat with one does not', async () => {
    const refresh = vi
      .spyOn(kiroService, 'refreshDefaultSessionOptions')
      .mockResolvedValue(undefined);
    const fresh = renderHook(() => useSessionOptions(null));
    fresh.result.current.refreshLists();
    expect(refresh).toHaveBeenCalledTimes(1);

    await db.conversations.add({ ...chat(undefined), id: 'conv-new' });
    const noSession = renderHook(() => useSessionOptions('conv-new'));
    await waitFor(async () => expect(await db.conversations.get('conv-new')).toBeDefined());
    await waitFor(() => {
      noSession.result.current.refreshLists();
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    await db.conversations.add(chat({ sessionId: SESSION, seenMessages: 2 }));
    const withSession = renderHook(() => useSessionOptions('conv-d9'));
    // Before and after the record is read
    withSession.result.current.refreshLists();
    await new Promise((r) => setTimeout(r, 30));
    withSession.result.current.refreshLists();
    expect(refresh).toHaveBeenCalledTimes(2);
    refresh.mockRestore();
  });
});
