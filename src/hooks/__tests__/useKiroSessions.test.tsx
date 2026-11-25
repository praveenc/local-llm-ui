import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import { db } from '../../db';
import { runningKiroSync } from '../../services/kiroSyncs';
import type { KiroSessionOpenResponse, KiroSessionSummary } from '../../utils/kiroSessions';
import type { KiroStatus } from '../../utils/kiroStatus';
import { loadPreferences, savePreferences } from '../../utils/preferences';
import {
  KIRO_SESSIONS_WINDOW_STORAGE_KEY,
  importNotice,
  useKiroSessions,
} from '../useKiroSessions';

const kiroStatus = vi.hoisted(() => ({ value: { state: 'signed-in' } as KiroStatus }));
vi.mock('../useKiroStatus', () => ({
  KIRO_STATUS_QUERY_KEY: ['kiro-status'],
  useKiroStatus: () => ({ status: kiroStatus.value, refresh: vi.fn(), isRefreshing: false }),
}));

const service = vi.hoisted(() => ({
  listSessions: vi.fn(),
  openSession: vi.fn(),
}));
vi.mock('../../services/kiro', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/kiro')>()),
  kiroService: service,
}));

const id = (n: number) => `sess_00000000-0000-4000-8000-00000000000${n}`;
const NOW = '2026-11-25T12:00:00.000Z';

const summary = (n: number, updatedAt = NOW): KiroSessionSummary => ({
  sessionId: id(n),
  title: `Session ${n}`,
  folder: 'cwd',
  updatedAt,
  status: 'idle',
});

const opened = (over: Partial<KiroSessionOpenResponse> = {}): KiroSessionOpenResponse => ({
  title: 'Session 1',
  updatedAt: NOW,
  messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello', credits: 0.01 },
  ],
  turns: 1,
  imagesLeftOut: 0,
  turnsLeftOut: 0,
  ...over,
});

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const show = (value: boolean | undefined) =>
  savePreferences({ ...loadPreferences(), showKiroSessions: value });

beforeEach(async () => {
  localStorage.clear();
  queryClient = new QueryClient();
  kiroStatus.value = { state: 'signed-in' } as KiroStatus;
  service.listSessions.mockReset().mockResolvedValue([summary(1), summary(2)]);
  service.openSession.mockReset().mockResolvedValue(opened());
  await db.conversations.clear();
  await db.messages.clear();
});

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

describe('useKiroSessions', () => {
  it('asks Kiro for nothing until the switch is on', async () => {
    const { result } = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    expect(result.current.enabled).toBe(false);
    show(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.enabled).toBe(false);
    expect(service.listSessions).not.toHaveBeenCalled();

    // Preferences turns it on: the hook follows without a reload
    act(() => show(true));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(service.listSessions).toHaveBeenCalledWith(7);
  });

  it('asks Kiro for nothing while Kiro is signed out', async () => {
    show(true);
    kiroStatus.value = { state: 'signed-out' } as KiroStatus;
    const { result } = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.enabled).toBe(false);
    expect(service.listSessions).not.toHaveBeenCalled();
  });

  it('hides the sessions that a conversation already holds', async () => {
    show(true);
    await db.conversations.add({
      id: 'c2',
      title: 'Session 2',
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
      messageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      providers: ['kiro'],
      models: [],
      kiro: { sessionId: id(2), seenMessages: 0 },
    });
    const { result } = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    await waitFor(() => expect(result.current.sessions?.map((s) => s.sessionId)).toEqual([id(1)]));
  });

  it('keeps the window and lists with it', async () => {
    show(true);
    localStorage.setItem(KIRO_SESSIONS_WINDOW_STORAGE_KEY, 'null');
    const { result } = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    expect(result.current.days).toBeNull();
    await waitFor(() => expect(service.listSessions).toHaveBeenCalledWith(null));
    act(() => result.current.setDays(30));
    await waitFor(() => expect(service.listSessions).toHaveBeenCalledWith(30));
    expect(localStorage.getItem(KIRO_SESSIONS_WINDOW_STORAGE_KEY)).toBe('30');
  });

  it('loads the list again on focus once a minute has passed', async () => {
    show(true);
    renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    await waitFor(() => expect(service.listSessions).toHaveBeenCalledTimes(1));

    // Focus within the minute: the list is fresh, no new call
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(service.listSessions).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(service.listSessions).toHaveBeenCalledTimes(2));
    focusManager.setFocused(undefined);
  });

  it('imports a session, opens it, and opens the same chat on a second click', async () => {
    show(true);
    const onOpen = vi.fn();
    const { result } = renderHook(() => useKiroSessions(onOpen), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    await act(async () => {
      await result.current.importSession(id(1));
    });
    expect(service.openSession).toHaveBeenCalledWith(id(1), 0);
    const conversation = await db.conversations.where('kiro.sessionId').equals(id(1)).first();
    expect(conversation).toMatchObject({ title: 'Session 1', kiro: { turns: 1, seenMessages: 2 } });
    expect(onOpen).toHaveBeenCalledWith(conversation?.id);
    expect(result.current.rows).toEqual({});
    await waitFor(() => expect(result.current.sessions?.map((s) => s.sessionId)).toEqual([id(2)]));

    await act(async () => {
      await result.current.importSession(id(1));
    });
    expect(service.openSession).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith(conversation?.id);
    expect(await db.conversations.count()).toBe(1);
  });

  it('shows the error of a failed import on its row and keeps no chat', async () => {
    show(true);
    service.openSession.mockRejectedValueOnce(new Error('Kiro could not open this session.'));
    const onOpen = vi.fn();
    const { result } = renderHook(() => useKiroSessions(onOpen), { wrapper });
    await act(async () => {
      await result.current.importSession(id(1));
    });
    expect(result.current.rows[id(1)]).toEqual({ error: 'Kiro could not open this session.' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(await db.conversations.count()).toBe(0);
  });

  it('says what an import left out', async () => {
    show(true);
    service.openSession.mockResolvedValueOnce(opened({ imagesLeftOut: 2, turnsLeftOut: 12 }));
    const { result } = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    await act(async () => {
      await result.current.importSession(id(1));
    });
    expect(result.current.notice).toBe('Imported. 2 images and 12 older turns were left out.');
  });

  it('adds the turns that Kiro made since the last sync when the chat opens', async () => {
    show(true);
    service.listSessions.mockResolvedValue([summary(1, '2026-11-25T13:00:00.000Z')]);
    const { result } = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
    await act(async () => {
      await result.current.importSession(id(1));
    });
    const conversation = await db.conversations.where('kiro.sessionId').equals(id(1)).first();
    await waitFor(() => expect(result.current.sessions).toEqual([]));

    service.openSession.mockResolvedValueOnce(
      opened({
        updatedAt: '2026-11-25T13:00:00.000Z',
        messages: [
          { role: 'user', content: 'from the terminal' },
          { role: 'assistant', content: 'ok' },
        ],
        turns: 2,
      })
    );
    act(() => result.current.syncIfNewer(conversation!.id));
    // A send waits for this sync
    const running = runningKiroSync(conversation!.id);
    expect(running).toBeDefined();
    await running;
    expect(await db.messages.count()).toBe(4);
    expect(service.openSession).toHaveBeenLastCalledWith(id(1), 1);
    expect((await db.conversations.get(conversation!.id))?.kiro).toMatchObject({
      turns: 2,
      updatedAt: '2026-11-25T13:00:00.000Z',
    });

    // Not newer any more: no replay
    act(() => result.current.syncIfNewer(conversation!.id));
    await new Promise((r) => setTimeout(r, 20));
    expect(service.openSession).toHaveBeenCalledTimes(2);
  });
});

describe('importNotice', () => {
  it('names what was left out, or nothing', () => {
    expect(importNotice(opened())).toBeNull();
    expect(importNotice(opened({ imagesLeftOut: 1 }))).toBe('Imported. 1 image was left out.');
    expect(importNotice(opened({ turnsLeftOut: 3 }))).toBe(
      'Imported. 3 older turns were left out.'
    );
  });
});
