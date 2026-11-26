/**
 * useKiroSessions Hook (K7, D10, D11)
 *
 * Kiro's sessions for the sidebar section, from Kiro's own list. On only when Kiro is signed in
 * and the "Show Kiro sessions in the sidebar" switch is on. The list loads when the section
 * shows, when the window gets focus, and every 60 s while the page is visible, at most once a
 * minute: each list call keeps Kiro CLI running, so a hidden page lets it stop.
 *
 * `importSession` makes a conversation from a session and opens it (a session that a
 * conversation already holds opens that conversation). `syncIfNewer` adds the turns that Kiro
 * made later (in the terminal) to an imported conversation. A session that is not in a list that
 * the browser holds is looked up in the All list (D23), and a chat with no turn count gets one
 * (D24). While the section is on, a send first adds the turns that a list in the browser already
 * shows (K11, `kiroSyncs.ts`).
 */
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { db } from '../db';
import { KiroSignedOutError, kiroService } from '../services/kiro';
import {
  KIRO_AUTO_MODEL,
  appendKiroTurns,
  backfillKiroTurns,
  findConversationByKiroSession,
  importKiroSession,
} from '../services/kiroImport';
import { setKiroSendCheck, trackKiroSync } from '../services/kiroSyncs';
import {
  DEFAULT_KIRO_SESSION_WINDOW,
  KIRO_COUNT_ONLY_SKIP,
  KIRO_SESSIONS_TTL_MS,
  KIRO_SESSION_WINDOWS,
  type KiroSessionOpenResponse,
  type KiroSessionSummary,
  type KiroSessionWindow,
  isNewerInKiro,
} from '../utils/kiroSessions';
import { PREFERENCES_CHANGED_EVENT, loadPreferences } from '../utils/preferences';
import { KIRO_STATUS_QUERY_KEY, useKiroStatus } from './useKiroStatus';

/** The section's window (Last 7 days, Last 30 days, All): UI state kept in the browser */
export const KIRO_SESSIONS_WINDOW_STORAGE_KEY = 'local-llm-ui-kiro-sessions-window';

export const KIRO_SESSIONS_QUERY_KEY = ['kiro-sessions'] as const;

export function loadKiroSessionWindow(): KiroSessionWindow {
  try {
    const stored = localStorage.getItem(KIRO_SESSIONS_WINDOW_STORAGE_KEY);
    if (stored === null) return DEFAULT_KIRO_SESSION_WINDOW;
    const value: unknown = JSON.parse(stored);
    return KIRO_SESSION_WINDOWS.includes(value as KiroSessionWindow)
      ? (value as KiroSessionWindow)
      : DEFAULT_KIRO_SESSION_WINDOW;
  } catch {
    return DEFAULT_KIRO_SESSION_WINDOW;
  }
}

function saveKiroSessionWindow(value: KiroSessionWindow): void {
  try {
    localStorage.setItem(KIRO_SESSIONS_WINDOW_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.error('Failed to save the Kiro sessions window:', error);
  }
}

/** The D11 switch, kept up to date when Preferences changes it */
function useShowKiroSessions(): boolean {
  const [show, setShow] = useState(() => loadPreferences().showKiroSessions === true);
  useEffect(() => {
    const update = () => setShow(loadPreferences().showKiroSessions === true);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return show;
}

/** A row's state while it imports, or its error in words */
export type KiroSessionRowState = { importing: true } | { error: string };

/** "Imported. 2 images and 12 older turns were left out." when the import left something out */
export function importNotice(session: KiroSessionOpenResponse): string | null {
  const parts: string[] = [];
  const { imagesLeftOut: images, turnsLeftOut: turns } = session;
  if (images > 0) parts.push(`${images} ${images === 1 ? 'image' : 'images'}`);
  if (turns > 0) parts.push(`${turns} older ${turns === 1 ? 'turn' : 'turns'}`);
  if (parts.length === 0) return null;
  return `Imported. ${parts.join(' and ')} ${images + turns === 1 ? 'was' : 'were'} left out.`;
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * The session's entry in the session lists that the browser holds (any window), the newest one
 * when several lists have it. With `maxAgeMs`, only lists loaded that recently count. No call.
 */
function cachedEntry(
  queryClient: QueryClient,
  sessionId: string,
  maxAgeMs?: number
): KiroSessionSummary | undefined {
  const now = Date.now();
  let found: KiroSessionSummary | undefined;
  for (const query of queryClient.getQueryCache().findAll({ queryKey: KIRO_SESSIONS_QUERY_KEY })) {
    const list = query.state.data as KiroSessionSummary[] | undefined;
    if (!list || (maxAgeMs !== undefined && now - query.state.dataUpdatedAt > maxAgeMs)) continue;
    const entry = list.find((s) => s.sessionId === sessionId);
    if (entry && (!found || Date.parse(entry.updatedAt) > Date.parse(found.updatedAt))) {
      found = entry;
    }
  }
  return found;
}

export interface UseKiroSessionsResult {
  /** Kiro is signed in and the switch is on: the section shows */
  enabled: boolean;
  /** The sessions that no conversation holds, newest first. Undefined until the first load. */
  sessions: KiroSessionSummary[] | undefined;
  /** The list could not load */
  listError: boolean;
  /** The menu's window: 7, 30, or null for All */
  days: KiroSessionWindow;
  setDays: (value: KiroSessionWindow) => void;
  refresh: () => void;
  rows: Record<string, KiroSessionRowState>;
  /** What the last import left out, in words */
  notice: string | null;
  importSession: (sessionId: string) => Promise<void>;
  syncIfNewer: (conversationId: string) => void;
}

export function useKiroSessions(onOpen: (conversationId: string) => void): UseKiroSessionsResult {
  const queryClient = useQueryClient();
  const { status } = useKiroStatus();
  const show = useShowKiroSessions();
  const enabled = show && status?.state === 'signed-in';
  const [days, setDaysState] = useState<KiroSessionWindow>(loadKiroSessionWindow);
  const [rows, setRows] = useState<Record<string, KiroSessionRowState>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const fetchList = useCallback(
    async (range: KiroSessionWindow) => {
      try {
        return await kiroService.listSessions(range);
      } catch (error) {
        // Signed out since the last check: the status hides the section
        if (error instanceof KiroSignedOutError) {
          void queryClient.invalidateQueries({ queryKey: KIRO_STATUS_QUERY_KEY });
        }
        throw error;
      }
    },
    [queryClient]
  );

  const query = useQuery({
    queryKey: [...KIRO_SESSIONS_QUERY_KEY, days],
    queryFn: () => fetchList(days),
    enabled,
    staleTime: KIRO_SESSIONS_TTL_MS,
    // Only while the page is visible: a hidden page lets Kiro CLI stop
    refetchInterval: KIRO_SESSIONS_TTL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // The Kiro sessions that a conversation already holds do not show in the section
  const imported = useLiveQuery(
    async () =>
      new Set(
        (await db.conversations.orderBy('kiro.sessionId').uniqueKeys()).filter(
          (key): key is string => typeof key === 'string'
        )
      ),
    [],
    new Set<string>()
  );

  const sessions = useMemo(
    () => query.data?.filter((s) => !imported.has(s.sessionId)),
    [query.data, imported]
  );

  const setDays = useCallback((value: KiroSessionWindow) => {
    setDaysState(value);
    saveKiroSessionWindow(value);
  }, []);

  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const busy = useRef(new Set<string>());

  const importSession = useCallback(
    async (sessionId: string) => {
      if (busy.current.has(sessionId)) return;
      busy.current.add(sessionId);
      setRows((prev) => ({ ...prev, [sessionId]: { importing: true } }));
      setNotice(null);
      try {
        const existing = await findConversationByKiroSession(sessionId);
        let conversationId = existing?.id;
        if (!conversationId) {
          const session = await kiroService.openSession(sessionId, 0);
          conversationId = await importKiroSession(sessionId, session, KIRO_AUTO_MODEL);
          setNotice(importNotice(session));
        }
        setRows((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        onOpen(conversationId);
      } catch (error) {
        console.error('Failed to import the Kiro session:', errorText(error, 'unknown error'));
        setRows((prev) => ({
          ...prev,
          [sessionId]: { error: errorText(error, 'Could not open this Kiro session.') },
        }));
      } finally {
        busy.current.delete(sessionId);
      }
    },
    [onOpen]
  );

  /**
   * The session's entry: from a list that the browser holds, else from the All list (D23). The
   * All list uses the section's query key and stale time, so it loads at most once a minute.
   */
  const findEntry = useCallback(
    async (sessionId: string) => {
      const cached = cachedEntry(queryClient, sessionId);
      if (cached) return cached;
      const all = await queryClient.fetchQuery({
        queryKey: [...KIRO_SESSIONS_QUERY_KEY, null],
        queryFn: () => fetchList(null),
        staleTime: KIRO_SESSIONS_TTL_MS,
      });
      return all.find((s) => s.sessionId === sessionId);
    },
    [queryClient, fetchList]
  );

  /** Adds the turns that Kiro made after the chat's count, or counts them (D24). Never rejects. */
  const syncConversation = useCallback(
    async (conversationId: string, known?: KiroSessionSummary) => {
      try {
        const kiro = (await db.conversations.get(conversationId))?.kiro;
        if (!kiro) return;
        const entry = known ?? (await findEntry(kiro.sessionId));
        if (!entry) return;
        if (kiro.turns !== undefined && !isNewerInKiro(entry.updatedAt, kiro)) return;
        if (busy.current.has(kiro.sessionId)) return;
        busy.current.add(kiro.sessionId);
        try {
          if (kiro.turns === undefined) {
            // No count (D24): count Kiro's turns and add no message. Turns that the terminal made
            // before this open are not imported; turns after it sync as usual.
            const session = await kiroService.openSession(kiro.sessionId, KIRO_COUNT_ONLY_SKIP);
            await backfillKiroTurns(conversationId, kiro.sessionId, session);
          } else {
            const session = await kiroService.openSession(kiro.sessionId, kiro.turns);
            await appendKiroTurns(conversationId, session);
          }
        } finally {
          busy.current.delete(kiro.sessionId);
        }
      } catch (error) {
        // The chat keeps its messages; the next open tries again
        console.error('Failed to add the new Kiro turns:', errorText(error, 'unknown error'));
      }
    },
    [findEntry]
  );

  const syncIfNewer = useCallback(
    (conversationId: string) => {
      if (!enabled) return;
      // A send into this chat waits for the sync, also while the All list loads (see kiroSyncs)
      void trackKiroSync(conversationId, syncConversation(conversationId));
    },
    [enabled, syncConversation]
  );

  // Before a send (K11): when a list that the browser holds already shows that Kiro has turns that
  // the chat does not have, the send waits until they are added. Only the lists that the browser
  // holds count, so the check adds no call to the send. A list older than its stale time does not
  // count: the page was hidden. The turn count of the reply does not depend on this: the server's
  // time of the session decides it.
  useEffect(() => {
    if (!enabled) return;
    return setKiroSendCheck(async (conversationId, onSync) => {
      const kiro = (await db.conversations.get(conversationId))?.kiro;
      if (!kiro || kiro.turns === undefined) return;
      const entry = cachedEntry(queryClient, kiro.sessionId, KIRO_SESSIONS_TTL_MS);
      if (!entry || !isNewerInKiro(entry.updatedAt, kiro)) return;
      onSync();
      await trackKiroSync(conversationId, syncConversation(conversationId, entry));
    });
  }, [enabled, queryClient, syncConversation]);

  return {
    enabled,
    sessions,
    listError: query.isError,
    days,
    setDays,
    refresh,
    rows,
    notice,
    importSession,
    syncIfNewer,
  };
}
