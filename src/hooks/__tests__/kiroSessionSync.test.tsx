/**
 * The sync of terminal turns together with a send in the app (K11): the sessions hook, the chat
 * hook, and the real database. A fake Kiro keeps the session's turns in order: the open route
 * returns the turns after `skipTurns`, as `server/kiro/replay.ts` does, and an app reply adds a
 * turn at the end, as Kiro does. With `ifUpdatedAfter` (`checkSession`) it answers unchanged when
 * Kiro's time is the same, as `server/kiro/sessions.ts` does. The chat route reports Kiro's time of
 * the session before and after the message, as `server/kiro/chat.ts` does (K11).
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
  /** The terminal holds the session: Kiro's list works, a load fails */
  held: false,
}));

/** The `skipTurns` of each replay that the open route ran */
const replays: number[] = [];

/** Kiro changes the session: at `at`, and always later than the last change */
const touch = (at = Date.now()) => {
  const last = kiro.updatedAt ? Date.parse(kiro.updatedAt) : 0;
  kiro.updatedAt = new Date(Math.max(at, last + 1000)).toISOString();
};

const service = vi.hoisted(() => ({
  listSessions: vi.fn(),
  openSession: vi.fn(),
  checkSession: vi.fn(),
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
  if (kiro.held) throw new Error(LEASE_TEXT);
  replays.push(skipTurns);
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

/** The open route with `ifUpdatedAfter`: no replay when Kiro's time is still the same */
function check(id: string, skipTurns: number, after: string) {
  if (Date.parse(after) === Date.parse(kiro.updatedAt)) {
    return { unchanged: true as const, updatedAt: kiro.updatedAt };
  }
  return open(id, skipTurns);
}

const encoder = new TextEncoder();

/** Kiro's text when another program (the terminal) holds the session */
const LEASE_TEXT =
  'This session is loaded in another program, Fake Terminal (pid 4242), which owns its execution.';

/**
 * The chat route: Kiro gets the prompt, adds the app's turn, and the reply streams. `stamps:
 * false` is a server that could not read Kiro's time. `outcome: 'lease'` is Kiro's refusal of
 * the prompt (another program holds the session: no turn); `'crash'` is a Kiro that took the
 * turn and stopped during the reply. `holdDone` holds the stream after `sessionUpdatedAt`, before
 * `[DONE]`, until it resolves (the end of a reply).
 */
function mockChatRoute(
  reply: string,
  {
    stamps = true,
    outcome = 'ok',
    holdDone,
  }: { stamps?: boolean; outcome?: 'ok' | 'lease' | 'crash'; holdDone?: Promise<void> } = {}
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
          read: async () => {
            if (holdDone && events[i] === '[DONE]') await holdDone;
            return i < events.length
              ? {
                  done: false,
                  value: encoder.encode(
                    `data: ${typeof events[i] === 'string' ? events[i++] : JSON.stringify(events[i++])}\n`
                  ),
                }
              : { done: true, value: undefined };
          },
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
  kiro.held = false;
  replays.length = 0;
  touch();
  service.listSessions.mockReset().mockImplementation(async (days: number | null) => list(days));
  service.openSession
    .mockReset()
    .mockImplementation(async (id: string, skip?: number) => open(id, skip));
  service.checkSession
    .mockReset()
    .mockImplementation(async (id: string, skip: number, after: string) => check(id, skip, after));
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

    // Later the chat opens again
    await reloadLists();
    await openChat(sessions);

    expect(await chatTexts()).toEqual([
      'first',
      'one',
      'from the terminal',
      'two',
      'from the app',
      'three',
    ]);
    expect(replays).toEqual([1]);
  });
});

/** The lists load again, as after the stale time or on focus */
async function reloadLists() {
  await act(async () => {
    await queryClient.invalidateQueries();
  });
}

const storedKiro = async () => (await db.conversations.get('c1'))?.kiro;

/** The sessions list never loads: the browser holds no list */
function noList() {
  service.listSessions.mockImplementation(() => new Promise(() => {}));
}

describe('a terminal turn, then at once a send, with no list in memory (K11 B4, E2E-B bug 1)', () => {
  it.each([
    ['on', true],
    ['off', false],
  ])(
    'imports the terminal turn before the send, and counts on (sessions section %s)',
    async (_name, section) => {
      savePreferences({ ...loadPreferences(), showKiroSessions: section });
      noList();
      kiro.turns = [{ user: 'one', assistant: 'one!' }];
      await storeChat(kiro.turns);
      kiro.turns.push({ user: 'two', assistant: 'two!' });
      touch();
      const { chat } = renderBoth();

      mockChatRoute('three!');
      await act(async () => {
        await chat.result.current.sendMessage('three');
      });
      kiro.turns.push({ user: 'four', assistant: 'four!' });
      touch();
      mockChatRoute('five!');
      await act(async () => {
        await chat.result.current.sendMessage('five');
      });

      expect(await chatTexts()).toEqual([
        'one',
        'one!',
        'two',
        'two!',
        'three',
        'three!',
        'four',
        'four!',
        'five',
        'five!',
      ]);
      expect(await storedKiro()).toMatchObject({ turns: 5, updatedAt: kiro.updatedAt });
      // One replay for each terminal turn, from the chat's count; no list was needed
      expect(replays).toEqual([1, 3]);
      expect(service.openSession).not.toHaveBeenCalled();
      if (!section) expect(service.listSessions).not.toHaveBeenCalled();
    }
  );

  it('sends anyway when the check fails, and stores no count when the chat was behind', async () => {
    noList();
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    service.checkSession.mockRejectedValue(new Error('Kiro could not open this session.'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { chat } = renderBoth();
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'three']);
    // The chat route's time decides: not in sync, so no count (the next open recounts)
    expect(await storedKiro()).toMatchObject({ updatedAt: syncedAt });
    expect((await storedKiro())?.turns).toBeUndefined();
  });
});

describe('an open uses the exact check, not the list (K11 B4, E2E-B bug 2)', () => {
  it('imports a terminal turn right after it, with no list in memory', async () => {
    noList();
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();

    const { sessions } = renderBoth();
    await openChat(sessions);
    expect(service.checkSession).toHaveBeenCalledWith(SESSION, 1, syncedAt);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the terminal', 'two']);
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });
  });

  it('makes one unchanged call for an unchanged chat, and adds nothing', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const { sessions } = renderBoth();
    await openChat(sessions);
    expect(service.checkSession).toHaveBeenCalledTimes(1);
    expect(replays).toEqual([]);
    expect(service.openSession).not.toHaveBeenCalled();
    expect(await chatTexts()).toEqual(['first', 'one']);
  });

  it('does nothing on open while the sessions section is off', async () => {
    savePreferences({ ...loadPreferences(), showKiroSessions: false });
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    const { sessions } = renderBoth();
    act(() => sessions.result.current.syncIfNewer('c1'));
    expect(runningKiroSync('c1')).toBeUndefined();
    expect(service.checkSession).not.toHaveBeenCalled();
    expect(await chatTexts()).toEqual(['first', 'one']);
  });
});

describe('a chat with no turn count (D24)', () => {
  it('gets a count and no messages, and a later terminal turn then syncs', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns, { turns: undefined, updatedAt: undefined });
    // Made in the terminal before the count: not imported
    kiro.turns.push({ user: 'before the count', assistant: 'two' });
    touch();

    const { sessions, chat } = renderBoth();
    await openChat(sessions);
    expect(service.openSession).toHaveBeenLastCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
    expect(await chatTexts()).toEqual(['first', 'one']);
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    kiro.turns.push({ user: 'after the count', assistant: 'three' });
    touch();
    await openChat(sessions);
    expect(replays[replays.length - 1]).toBe(2);
    expect(await chatTexts()).toEqual(['first', 'one', 'after the count', 'three']);
    expect((await storedKiro())?.turns).toBe(3);

    // A send into a chat with no count does not check: the next open counts
    await db.conversations.update('c1', { kiro: { ...(await storedKiro())!, turns: undefined } });
    service.checkSession.mockClear();
    mockChatRoute('four');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(service.checkSession).not.toHaveBeenCalled();
  });
});

describe("Kiro's time after an app reply (D25)", () => {
  it('runs no replay on the next open, and a terminal turn after it still syncs', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);

    const { sessions, chat } = renderBoth();
    await openChat(sessions);
    mockChatRoute('two');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    await openChat(sessions);
    expect(replays).toEqual([]);

    kiro.turns.push({ user: 'from the terminal', assistant: 'three' });
    touch();
    await openChat(sessions);
    expect(replays).toEqual([2]);
    expect(await chatTexts()).toEqual([
      'first',
      'one',
      'from the app',
      'two',
      'from the terminal',
      'three',
    ]);
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

  it('stores no count when the server could not read the time', async () => {
    savePreferences({ ...loadPreferences(), showKiroSessions: false });
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
    await openChat(sessions);

    // A turn in the terminal, which still holds the session: the check cannot load it, and Kiro
    // refuses the app's prompt
    kiro.turns.push({ user: 'from the terminal', assistant: 'two' });
    touch();
    kiro.held = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockChatRoute('three', { outcome: 'lease' });
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(chat.result.current.error).toContain('loaded in another program');
    // The count and the time of the last sync stay
    expect(await storedKiro()).toMatchObject({ turns: 1, updatedAt: syncedAt });

    // The user closes the terminal; the chat opens again
    kiro.held = false;
    await openChat(sessions);
    expect(replays).toEqual([1]);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'from the terminal', 'two']);
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    // Retry: in sync now, and the reply counts on
    mockChatRoute('three');
    await act(async () => {
      await chat.result.current.sendMessage('from the app');
    });
    expect(await storedKiro()).toMatchObject({ turns: 3, updatedAt: kiro.updatedAt });
    await openChat(sessions);
    expect(replays).toEqual([1]);
    expect((await chatTexts()).filter((t) => t === 'from the terminal')).toHaveLength(1);
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

      await openChat(sessions);
      // A count only: the app's turn is not imported again
      expect(service.openSession).toHaveBeenLastCalledWith(SESSION, KIRO_COUNT_ONLY_SKIP);
      expect((await chatTexts()).filter((t) => t === 'from the app')).toHaveLength(1);
      expect((await chatTexts()).filter((t) => t === 'from the terminal')).toHaveLength(
        terminalTurn ? 1 : 0
      );
      expect((await storedKiro())?.turns).toBe(kiro.turns.length);
    }
  );
});

describe('an open during the end of an app reply (K11 B5, review B4 finding 1)', () => {
  it('makes no open call and never imports the reply twice', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    const syncedAt = kiro.updatedAt;
    const { sessions, chat } = renderBoth();
    await openChat(sessions);

    let endReply: () => void = () => {};
    const holdDone = new Promise<void>((resolve) => {
      endReply = resolve;
    });
    mockChatRoute('two', { holdDone });
    let sent: Promise<void> = Promise.resolve();
    act(() => {
      sent = chat.result.current.sendMessage('from the app');
    });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // The stream is past sessionUpdatedAt and waits before [DONE]
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Kiro has the turn; the chat still holds the old count and time
    expect(kiro.turns).toHaveLength(2);
    expect(await storedKiro()).toMatchObject({ turns: 1, updatedAt: syncedAt });

    const checks = service.checkSession.mock.calls.length;
    await openChat(sessions);
    expect(service.checkSession).toHaveBeenCalledTimes(checks);
    expect(service.openSession).not.toHaveBeenCalled();
    expect(replays).toEqual([]);

    await act(async () => {
      endReply();
      await sent;
    });
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'two']);
    expect(await storedKiro()).toMatchObject({ turns: 2, updatedAt: kiro.updatedAt });

    // After the reply, an open checks again and finds nothing new
    await openChat(sessions);
    expect(replays).toEqual([]);
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'two']);
  });
});

describe('a slow check before a send (K11 B5, review B4 finding 3)', () => {
  it('says "Checking the Kiro session…" while it runs, then sends', async () => {
    kiro.turns = [{ user: 'first', assistant: 'one' }];
    await storeChat(kiro.turns);
    let endCheck: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      endCheck = resolve;
    });
    service.checkSession.mockImplementation(async (id: string, skip: number, after: string) => {
      // The check starts Kiro CLI: a few seconds
      await slow;
      return check(id, skip, after);
    });
    const { chat } = renderBoth();
    mockChatRoute('two');
    let sent: Promise<void> = Promise.resolve();
    act(() => {
      sent = chat.result.current.sendMessage('from the app');
    });
    await waitFor(() => expect(chat.result.current.status).toBe('submitted'));
    expect(chat.result.current.streamStatus).toBeNull();
    await waitFor(() =>
      expect(chat.result.current.streamStatus).toBe('Checking the Kiro session…')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => {
      endCheck();
      await sent;
    });
    expect(chat.result.current.streamStatus).toBeNull();
    expect(await chatTexts()).toEqual(['first', 'one', 'from the app', 'two']);
  });
});
