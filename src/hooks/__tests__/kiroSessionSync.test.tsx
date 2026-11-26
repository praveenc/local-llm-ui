/**
 * The sync of terminal turns together with a send in the app (K11): the sessions hook, the chat
 * hook, and the real database. A fake Kiro keeps the session's turns in order: the open route
 * returns the turns after `skipTurns`, as `server/kiro/replay.ts` does, and an app reply adds a
 * turn at the end, as Kiro does. The chat route reports Kiro's time of the session before and
 * after the message, as `server/kiro/chat.ts` does (K11).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import { db } from '../../db';
import { runningKiroSync } from '../../services/kiroSyncs';
import {
  KIRO_COUNT_ONLY_SKIP,
  type KiroSessionOpenResponse,
  type KiroSessionSummary,
} from '../../utils/kiroSessions';
import type { KiroStatus } from '../../utils/kiroStatus';
import { loadPreferences, savePreferences } from '../../utils/preferences';
import type { ChatModel } from '../useBedrockChat';
import { useBedrockChat } from '../useBedrockChat';
import { useKiroSessions } from '../useKiroSessions';

const SESSION = 'sess_00000000-0000-4000-8000-000000000001';
const DAY = 24 * 60 * 60 * 1000;

vi.mock('../useKiroStatus', () => ({
  KIRO_STATUS_QUERY_KEY: ['kiro-status'],
  useKiroStatus: () => ({
    status: { state: 'signed-in' } as KiroStatus,
    refresh: vi.fn(),
    isRefreshing: false,
  }),
}));

interface Turn {
  user: string;
  assistant: string;
}

/** Kiro's side of the one session */
const kiro = vi.hoisted(() => ({
  turns: [] as { user: string; assistant: string }[],
  updatedAt: '',
}));

/** Kiro changes the session: at `at`, and always later than the last change */
const touch = (at = Date.now()) => {
  const last = kiro.updatedAt ? Date.parse(kiro.updatedAt) : 0;
  kiro.updatedAt = new Date(Math.max(at, last + 1000)).toISOString();
};

const service = vi.hoisted(() => ({
  listSessions: vi.fn(),
  openSession: vi.fn(),
  rememberSessionOptions: vi.fn(),
  // The send reads Kiro's lists for the process-wide options (K11, C); none are loaded here.
  getSessionOptions: vi.fn(() => null),
}));
vi.mock('../../services/kiro', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/kiro')>()),
  kiroService: service,
}));
vi.mock('../../services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services')>()),
  mantleService: { getApiKey: () => '', getRegion: () => '' },
}));

const summary = (): KiroSessionSummary => ({
  sessionId: SESSION,
  title: 'Session',
  folder: 'cwd',
  updatedAt: kiro.updatedAt,
  status: 'idle',
});

/** The list for a window, as the server cuts it */
function list(days: number | null): KiroSessionSummary[] {
  if (days !== null && Date.parse(kiro.updatedAt) < Date.now() - days * DAY) return [];
  return [summary()];
}

/** The open route: the turns after `skipTurns`, and the count of all turns */
function open(_id: string, skipTurns = 0): KiroSessionOpenResponse {
  return {
    title: 'Session',
    updatedAt: kiro.updatedAt,
    messages: kiro.turns.slice(skipTurns).flatMap((t) => [
      { role: 'user' as const, content: t.user },
      { role: 'assistant' as const, content: t.assistant },
    ]),
    turns: kiro.turns.length,
    imagesLeftOut: 0,
    turnsLeftOut: 0,
  };
}

const encoder = new TextEncoder();

/** Kiro's text when another program (the terminal) holds the session */
const LEASE_TEXT =
  'This session is loaded in another program, Fake Terminal (pid 4242), which owns its execution.';

/**
 * The chat route: Kiro gets the prompt, adds the app's turn, and the reply streams. `stamps:
 * false` is a server that could not read Kiro's time. `outcome: 'lease'` is Kiro's refusal of
 * the prompt (another program holds the session: no turn); `'crash'` is a Kiro that took the
 * turn and stopped during the reply.
 */
function mockChatRoute(
  reply: string,
  { stamps = true, outcome = 'ok' }: { stamps?: boolean; outcome?: 'ok' | 'lease' | 'crash' } = {}
) {
  globalThis.fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { prompt: string };
    // Kiro's time of the session before the message (session/list, K11)
    const before = kiro.updatedAt;
    if (outcome !== 'lease') {
      kiro.turns.push({ user: body.prompt, assistant: reply });
      touch();
    }
    const start = [
      { session: { id: SESSION, created: false } },
      ...(stamps ? [{ sessionUpdatedBefore: before }] : []),
    ];
    const events =
      outcome === 'lease'
        ? [...start, { error: LEASE_TEXT }]
        : outcome === 'crash'
          ? [...start, { content: reply }, { error: 'Kiro stopped during the reply.' }]
          : [
              ...start,
              { content: reply },
              // Kiro's time of the session after the turn (K11)
              ...(stamps ? [{ sessionUpdatedAt: kiro.updatedAt }] : []),
              '[DONE]',
            ];
    let i = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            i < events.length
              ? {
                  done: false,
                  value: encoder.encode(
                    `data: ${typeof events[i] === 'string' ? events[i++] : JSON.stringify(events[i++])}\n`
                  ),
                }
              : { done: true, value: undefined },
        }),
      },
    };
  }) as never;
}

const model: ChatModel = { id: 'claude-haiku-5.5', name: 'Claude Haiku 5.5', provider: 'kiro' };

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** A chat that holds the session's turns, synced at `updatedAt` */
async function storeChat(turns: Turn[], kiroFields: Record<string, unknown> = {}) {
  await db.conversations.add({
    id: 'c1',
    title: 'Session',
    createdAt: new Date(kiro.updatedAt),
    updatedAt: new Date(kiro.updatedAt),
    status: 'active',
    messageCount: turns.length * 2,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    providers: ['kiro'],
    models: ['auto'],
    kiro: {
      sessionId: SESSION,
      seenMessages: turns.length * 2,
      turns: turns.length,
      updatedAt: kiro.updatedAt,
      ...kiroFields,
    },
  });
  await db.messages.bulkAdd(
    turns.flatMap((t, i) => [
      {
        id: `u${i}`,
        conversationId: 'c1',
        role: 'user' as const,
        content: t.user,
        sequence: i * 2,
        createdAt: new Date(),
        provider: 'kiro' as const,
        modelId: 'auto',
        modelName: 'auto',
      },
      {
        id: `a${i}`,
        conversationId: 'c1',
        role: 'assistant' as const,
        content: t.assistant,
        sequence: i * 2 + 1,
        createdAt: new Date(),
        provider: 'kiro' as const,
        modelId: 'auto',
        modelName: 'auto',
      },
    ])
  );
}

const chatTexts = async () =>
  (await db.messages.where('conversationId').equals('c1').sortBy('sequence')).map((m) => m.content);

function renderBoth() {
  const sessions = renderHook(() => useKiroSessions(vi.fn()), { wrapper });
  const chat = renderHook(
    () =>
      useBedrockChat({
        conversationId: 'c1',
        selectedModel: model,
        maxTokens: 4096,
        maxToolSteps: 10,
        thinkingEffort: 'default',
      }),
    { wrapper }
  );
  return { sessions, chat };
}

/** The user clicks the chat in the sidebar, as `Sidebar.tsx` does */
async function openChat(sessions: ReturnType<typeof renderBoth>['sessions']) {
  act(() => sessions.result.current.syncIfNewer('c1'));
  await act(async () => {
    await runningKiroSync('c1');
  });
}

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  localStorage.clear();
  savePreferences({ ...loadPreferences(), showKiroSessions: true });
  queryClient = new QueryClient();
  kiro.turns = [];
  kiro.updatedAt = '';
  touch();
  service.listSessions.mockReset().mockImplementation(async (days: number | null) => list(days));
  service.openSession
    .mockReset()
    .mockImplementation(async (id: string, skip?: number) => open(id, skip));
  service.rememberSessionOptions.mockReset();
  await db.conversations.clear();
  await db.messages.clear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  queryClient.clear();
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a terminal turn, then a send in the app before the sync (K11 step 1)', () => {
  it('never imports the app reply twice and keeps the order of Kiro', async () => {
    // A session that Kiro last changed 10 days ago: outside the default window (Last 7 days)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-12-06T12:00:00.000Z'));
    kiro.updatedAt = '2026-11-26T12:00:00.000Z';
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    // A turn in the terminal, also 10 days ago: the list of the window does not have it
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch(Date.parse('2026-11-26T12:05:00.000Z'));

    const { sessions, chat } = renderBoth();
    await waitFor(() => expect(sessions.result.current.sessions).toEqual([]));
    // The click on the chat, then a message at once
    await openChat(sessions);
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });

    // Later the chat opens again (the session is in the window now)
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);

    expect(await chatTexts()).toEqual([
      'first',
      'one',
      'from the terminal',
      'two',
      'from the app',
      'three',
    ]);
  });
});

/** The lists load again, as after the stale time or on focus */
async function reloadLists() {
  await act(async () => {
    await queryClient.invalidateQueries();
  });
}

const storedKiro = async () => (await db.conversations.get('c1'))?.kiro;

describe('a session that is not in the list of the window (D23)', () => {
  it('syncs from the All list, and asks for it once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-12-06T12:00:00.000Z'));
    kiro.updatedAt = '2026-11-26T12:00:00.000Z';
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch(Date.parse('2026-11-26T12:05:00.000Z'));

    const { sessions } = renderBoth();
    await waitFor(() => expect(sessions.result.current.sessions).toEqual([]));
    await openChat(sessions);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the terminal', 'two']);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, 1);
    expect(service.listSessions).toHaveBeenCalledWith(null);

    // A second open in the same minute: no new list call, and nothing newer
    await openChat(sessions);
    expect(service.listSessions.mock.calls.filter(([days]) => days === null)).toHaveLength(1);
    expect(service.openSession).toHaveBeenCalledTimes(1);
  });

  it('syncs a click that comes before the list of the window has loaded', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    // The list of the window does not load in this test
    service.listSessions.mockImplementation((days: number | null) =>
      days === null ? Promise.resolve(list(null)) : new Promise(() => {})
    );

    const { sessions } = renderBoth();
    await openChat(sessions);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the terminal', 'two']);
    expect((await storedKiro())?.turns).toBe(2);
  });
});

describe('a chat with no turn count (D24)', () => {
  it('gets a count and no messages, and a later terminal turn then syncs', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns, { turns: undefined, updatedAt: undefined });
    // Made in the terminal before the count: not imported
    kiro.turns.push({ user: 'before the count', assistant: 'two' });
    touch();

    const { sessions } = renderBoth();
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
    expect(await chatTexts()).toEqual(['first', 'one']);
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    kiro.turns.push({ user: 'after the count', assistant: 'three' });
    touch();
    await reloadLists();
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, 2);
    expect(await chatTexts()).toEqual(['first', 'one', 'after the count', 'three']);
    expect((await storedKiro())?.turns).toBe(3);
  });
});

describe("Kiro's time after an app reply (D25)", () => {
  it('runs no replay on the next open, and a terminal turn after it still syncs', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);

    const { sessions, chat } = renderBoth();
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);
    mockChatRoute('two');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    // The list now shows Kiro's time of the app reply: the chat has it already
    await reloadLists();
    await openChat(sessions);
    expect(service.openSession).not.toHaveBeenCalled();

    kiro.turns.push({ user: 'from the terminal', assistant: 'three' });
    touch();
    await reloadLists();
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, 2);
    expect(await chatTexts()).toEqual([
      'first',
      'one',
      'from the app',
      'two',
      'from the terminal',
      'three',
    ]);
  });

  it('gives no time and no count when Kiro has a turn that the browser did not see, and never imports one twice', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    // No list in the browser yet: only the server's time shows the terminal turn
    let release: () => void = () => {};
    const loaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.listSessions.mockImplementation(async (days: number | null) => {
      await loaded;
      return list(days);
    });

    const { sessions, chat } = renderBoth();
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ updatedAt: syncedAt });
    expect((await storedKiro())?.turns).toBeUndefined();

    release();
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);
    // A count only: the terminal turn is not imported, and the app reply is not imported again
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'three']);
    expect(await storedKiro()).toMatchObject({ turns: 3, updatedAt: kiro.updatedAt });
  });
});

describe('a send when the list in the browser shows a newer session (K11)', () => {
  it('adds the terminal turns first, then sends, in the order of Kiro', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const { sessions, chat } = renderBoth();
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);

    // A terminal turn; the list loads again while the chat stays open (no click)
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    await reloadLists();
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });

    expect(service.openSession).toHaveBeenCalledWith(SESSION, 1);
    expect(await chatTexts()).toEqual([
      'first',
      'one',
      'from the terminal',
      'two',
      'from the app',
      'three',
    ]);
    expect(await storedKiro()).toMatchObject({ turns: 3, updatedAt: kiro.updatedAt });
  });

  it('counts on after a list older than its stale time, when Kiro has nothing new', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const { sessions, chat } = renderBoth();
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);

    // The page was hidden for two minutes: the list is old, the server's time is exact
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 120_000);
    mockChatRoute('two');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });
  });
});

describe('a send with the sessions section off (K11)', () => {
  beforeEach(() => {
    savePreferences({ ...loadPreferences(), showKiroSessions: false });
  });

  it("counts the turn and stores Kiro's time when Kiro has nothing new", async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const { chat } = renderBoth();
    mockChatRoute('two');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(service.listSessions).not.toHaveBeenCalled();
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    // A second reply counts on as well
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('again');
    });
    expect(await storedKiro()).toMatchObject({ turns: 3, updatedAt: kiro.updatedAt });
  });

  it('stores no count after a terminal turn, and the next open counts again with no duplicate', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    const { sessions, chat } = renderBoth();
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ updatedAt: syncedAt });
    expect((await storedKiro())?.turns).toBeUndefined();

    // The section is turned on, and the chat opens
    act(() => savePreferences({ ...loadPreferences(), showKiroSessions: true }));
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'three']);
    expect(await storedKiro()).toMatchObject({ turns: 3, updatedAt: kiro.updatedAt });
  });

  it('stores no count when the server could not read the time', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const { chat } = renderBoth();
    mockChatRoute('two', { stamps: false });
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect((await storedKiro())?.turns).toBeUndefined();
  });
});

describe('a reply that fails after the session event (K11, review B finding 1)', () => {
  it('keeps the count when Kiro refuses the message, and the next open imports the terminal turn once', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    const { sessions, chat } = renderBoth();
    // The list in the browser shows the chat in sync
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);

    // A turn in the terminal, which still holds the session: Kiro refuses the app's prompt
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    mockChatRoute('three', { outcome: 'lease' });
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(chat.result.current.error).toContain('loaded in another program');
    // The count and the time of the last sync stay
    expect(await storedKiro()).toMatchObject({ turns: 1, updatedAt: syncedAt });

    // The user closes the terminal; the chat opens again
    await reloadLists();
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, 1);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'from the terminal', 'two']);
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    // Retry: in sync now, and the reply counts on
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ turns: 3, updatedAt: kiro.updatedAt });
    await reloadLists();
    await openChat(sessions);
    expect(service.openSession).toHaveBeenCalledTimes(1);
    expect((await chatTexts()).filter((t) => t === 'from the terminal')).toHaveLength(1);
  });

  it('keeps the count when Kiro refuses a message that was not in sync', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    // The browser has no list yet: only the server's time shows the terminal turn
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    let release: () => void = () => {};
    const loaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.listSessions.mockImplementation(async (days: number | null) => {
      await loaded;
      return list(days);
    });
    const { sessions, chat } = renderBoth();
    mockChatRoute('three', { outcome: 'lease' });
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ turns: 1, updatedAt: syncedAt });

    release();
    await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, 1);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'from the terminal', 'two']);
    expect((await storedKiro())?.turns).toBe(2);
  });

  it.each([
    ['in sync', false],
    ['not in sync', true],
  ])(
    'stores no count when Kiro took the message and then failed (%s), and never imports a turn twice',
    async (_name, terminalTurn) => {
      kiro.turns = [{ user: 'first', assistant: 'one' }];
      await storeChat(kiro.turns);
      const { sessions, chat } = renderBoth();
      await waitFor(() => expect(queryClient.getQueryData(['kiro-sessions', 7])).toHaveLength(1));
      await openChat(sessions);
      if (terminalTurn) {
        kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
        touch();
      }
      mockChatRoute('partial', { outcome: 'crash' });
      await act(async () => {
        await chat.result.current.sendMessage('from the app');
      });
      expect((await storedKiro())?.turns).toBeUndefined();

      await reloadLists();
      await openChat(sessions);
      // A count only: the app's turn is not imported again
      expect(service.openSession).toHaveBeenLastCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
      expect((await chatTexts()).filter((t) => t === 'from the app')).toHaveLength(1);
      expect((await storedKiro())?.turns).toBe(kiro.turns.length);
    }
  );
});
