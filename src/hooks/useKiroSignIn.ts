/**
 * useKiroSignIn Hook
 *
 * Signs in to Kiro CLI (and out of it) through the app's server. `start` must run in a click
 * handler: it opens the sign-in tab at once, while the browser still counts the click, and sends
 * that tab to the sign-in page when the server has the code. The server stops the sign-in when
 * the request ends, so `cancel` and the end of the component abort the request.
 */
import { useQueryClient } from '@tanstack/react-query';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { kiroService } from '../services';
import { isAllowedSignInUrl } from '../utils/kiroLogin';
import type { KiroLoginEvent, KiroLoginMethod } from '../utils/kiroLogin';
import type { KiroStatus } from '../utils/kiroStatus';
import { KIRO_STATUS_QUERY_KEY } from './useKiroStatus';

export type KiroSignInPhase = 'idle' | 'starting' | 'waiting' | 'error';

export interface KiroSignInState {
  phase: KiroSignInPhase;
  /** The code that the sign-in page shows; the person compares it */
  code?: string;
  url?: string;
  message?: string;
}

export interface KiroSignIn extends KiroSignInState {
  /** Call it from a click handler, so the browser allows the new tab */
  start: (method: KiroLoginMethod) => void;
  /** Stops a running sign-in */
  cancel: () => void;
  /** Back to idle, after an error */
  reset: () => void;
  /** Resolves with true when kiro-cli signed out */
  signOut: () => Promise<boolean>;
  isSigningOut: boolean;
  signOutError?: string;
}

const IDLE: KiroSignInState = { phase: 'idle' };

/** Sends the tab that start() opened to the sign-in page. It cannot reach the app after that. */
function openSignInPage(popup: Window | null, url: string): void {
  if (!popup || popup.closed) return;
  try {
    popup.opener = null;
    popup.location.replace(url);
  } catch {
    // The tab is not ours any more; the row still shows the link
  }
}

/** Closes the tab from start() when it never left about:blank */
function closeBlankPopup(popup: Window | null): void {
  if (!popup || popup.closed) return;
  try {
    // Reading the address of a tab on another origin throws, and then the tab stays open
    if (popup.location.href === 'about:blank') popup.close();
  } catch {
    // On the sign-in page already
  }
}

export interface KiroSignInOptions {
  /**
   * A sign-in that start() began ended signed in. Runs after the status query has `status`.
   * A sign-in from a terminal never calls it.
   */
  onSignedIn?: (status: KiroStatus) => void;
  /** A sign-in that start() began ended with an error */
  onError?: (message: string) => void;
}

export function useKiroSignIn(options: KiroSignInOptions = {}): KiroSignIn {
  const queryClient = useQueryClient();
  const [state, setState] = useState<KiroSignInState>(IDLE);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | undefined>();
  const controller = useRef<AbortController | null>(null);
  const popup = useRef<Window | null>(null);
  /** The run id from the `started` event of the sign-in that runs */
  const runId = useRef<string | undefined>(undefined);

  const callbacks = useRef(options);
  useLayoutEffect(() => {
    callbacks.current = options;
  });

  useEffect(
    () => () => {
      controller.current?.abort();
      closeBlankPopup(popup.current);
      popup.current = null;
    },
    []
  );

  const start = useCallback(
    (method: KiroLoginMethod) => {
      if (controller.current) return;
      // Before any await: only now does the browser let the click open a tab
      popup.current = window.open('about:blank', '_blank');
      const abort = new AbortController();
      controller.current = abort;
      runId.current = undefined;
      setState({ phase: 'starting' });

      const fail = (message: string) => {
        closeBlankPopup(popup.current);
        popup.current = null;
        setState({ phase: 'error', message });
        callbacks.current.onError?.(message);
      };
      const startUrl = method.method === 'identity-center' ? method.startUrl : undefined;
      const region = method.method === 'identity-center' ? method.region : undefined;
      let ended = false;

      const onEvent = (event: KiroLoginEvent) => {
        if (abort.signal.aborted || ended) return;
        switch (event.state) {
          case 'started':
            runId.current = event.runId;
            return;
          case 'code':
            if (!isAllowedSignInUrl(event.url, startUrl, region)) {
              ended = true;
              abort.abort();
              fail('The sign-in page is not one that the app trusts');
              return;
            }
            openSignInPage(popup.current, event.url);
            setState({ phase: 'waiting', code: event.code, url: event.url });
            return;
          case 'done':
            ended = true;
            popup.current = null;
            queryClient.setQueryData(KIRO_STATUS_QUERY_KEY, event.status);
            setState(IDLE);
            callbacks.current.onSignedIn?.(event.status);
            return;
          case 'error':
            ended = true;
            fail(event.message);
            return;
          default:
            return;
        }
      };

      void kiroService
        .startLogin(method, { signal: abort.signal, onEvent })
        .then(() => {
          if (!ended && !abort.signal.aborted) fail('The sign-in ended without a result');
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted || ended) return;
          fail(error instanceof Error ? error.message : 'Could not start the sign-in');
        })
        .finally(() => {
          if (controller.current === abort) controller.current = null;
        });
    },
    [queryClient]
  );

  const cancel = useCallback(() => {
    const abort = controller.current;
    if (!abort) return;
    abort.abort();
    controller.current = null;
    closeBlankPopup(popup.current);
    popup.current = null;
    setState(IDLE);
    // The server stops the sign-in when the request ends. This makes sure of it, for this run
    // only: a late cancel must not stop a newer sign-in.
    const id = runId.current;
    runId.current = undefined;
    if (id) void kiroService.cancelLogin(id).catch(() => {});
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  const signOut = useCallback(async () => {
    setIsSigningOut(true);
    setSignOutError(undefined);
    try {
      queryClient.setQueryData(KIRO_STATUS_QUERY_KEY, await kiroService.logout());
      return true;
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out');
      return false;
    } finally {
      setIsSigningOut(false);
    }
  }, [queryClient]);

  return { ...state, start, cancel, reset, signOut, isSigningOut, signOutError };
}
