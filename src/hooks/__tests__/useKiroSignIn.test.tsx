import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import type { KiroLoginEvent, KiroLoginMethod } from '../../utils/kiroLogin';
import type { KiroStatus } from '../../utils/kiroStatus';
import { useKiroSignIn } from '../useKiroSignIn';
import { KIRO_STATUS_QUERY_KEY } from '../useKiroStatus';

const service = vi.hoisted(() => ({
  startLogin: vi.fn(),
  cancelLogin: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../../services', () => ({ kiroService: service }));

const URL_OK = 'https://view.awsapps.com/start/#/device?user_code=ABCD-EFGH';
const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/kiro-cli',
  version: '3.6.0',
  account: { type: 'builder-id', email: 'a@example.com' },
};

interface FakePopup {
  opener: unknown;
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
  location: { href: string; replace: ReturnType<typeof vi.fn> };
}

const fakePopup = (): FakePopup => ({
  opener: {},
  closed: false,
  close: vi.fn(),
  location: { href: 'about:blank', replace: vi.fn() },
});

/** A startLogin that lets the test send events and end the stream */
function controlledLogin() {
  let onEvent: (event: KiroLoginEvent) => void = () => {};
  let end: () => void = () => {};
  service.startLogin.mockImplementation(
    (_method: KiroLoginMethod, options: { onEvent: typeof onEvent }) => {
      onEvent = options.onEvent;
      return new Promise<void>((resolve) => {
        end = resolve;
      });
    }
  );
  return {
    send: (event: KiroLoginEvent) => act(() => onEvent(event)),
    end: () =>
      act(async () => {
        end();
      }),
  };
}

describe('useKiroSignIn', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const open = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient();
    service.startLogin.mockReset();
    service.cancelLogin.mockReset().mockResolvedValue(true);
    service.logout.mockReset();
    open.mockReset();
    vi.stubGlobal('open', open);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the tab before the request, then sends it to the sign-in page', async () => {
    const popup = fakePopup();
    open.mockReturnValue(popup);
    const login = controlledLogin();
    const onSignedIn = vi.fn();
    const { result } = renderHook(() => useKiroSignIn({ onSignedIn }), { wrapper });

    act(() => result.current.start({ method: 'builder-id' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(
      service.startLogin.mock.invocationCallOrder[0]
    );
    expect(result.current.phase).toBe('starting');

    await login.send({ state: 'started' });
    await login.send({ state: 'code', code: 'ABCD-EFGH', url: URL_OK });
    expect(result.current).toMatchObject({ phase: 'waiting', code: 'ABCD-EFGH', url: URL_OK });
    expect(popup.opener).toBeNull();
    expect(popup.location.replace).toHaveBeenCalledWith(URL_OK);

    await login.send({ state: 'done', status: SIGNED_IN });
    expect(result.current.phase).toBe('idle');
    expect(queryClient.getQueryData(KIRO_STATUS_QUERY_KEY)).toEqual(SIGNED_IN);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();
    await login.end();
  });

  it('shows the link only when the browser blocks the tab', async () => {
    open.mockReturnValue(null);
    const login = controlledLogin();
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    await login.send({ state: 'code', code: 'ABCD-EFGH', url: URL_OK });
    expect(result.current).toMatchObject({ phase: 'waiting', url: URL_OK });
  });

  it('does not open a page that the app does not trust', async () => {
    const popup = fakePopup();
    open.mockReturnValue(popup);
    const login = controlledLogin();
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    await login.send({ state: 'code', code: 'ABCD-EFGH', url: 'https://evil.example/' });
    expect(result.current.phase).toBe('error');
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
  });

  it('shows the error of the server and closes the blank tab', async () => {
    const popup = fakePopup();
    open.mockReturnValue(popup);
    const login = controlledLogin();
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    await login.send({ state: 'error', message: 'Already signed in' });
    expect(result.current).toMatchObject({ phase: 'error', message: 'Already signed in' });
    expect(popup.close).toHaveBeenCalledTimes(1);
    await login.end();
    expect(result.current.phase).toBe('error');

    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
  });

  it('leaves a tab alone that is on the sign-in page already', async () => {
    const popup = fakePopup();
    Object.defineProperty(popup.location, 'href', {
      get() {
        throw new Error('SecurityError');
      },
    });
    open.mockReturnValue(popup);
    const login = controlledLogin();
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    await login.send({ state: 'code', code: 'ABCD-EFGH', url: URL_OK });
    await login.send({ state: 'error', message: 'Sign-in timed out' });
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('shows the message when the request fails, for example with 409', async () => {
    open.mockReturnValue(null);
    service.startLogin.mockRejectedValue(new Error('A sign-in is already running'));
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.message).toBe('A sign-in is already running');
  });

  it('shows an error when the stream ends without a result', async () => {
    open.mockReturnValue(null);
    const login = controlledLogin();
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    await login.end();
    await waitFor(() => expect(result.current.phase).toBe('error'));
  });

  it('cancels: aborts the request, asks the server, and closes the blank tab', async () => {
    const popup = fakePopup();
    open.mockReturnValue(popup);
    controlledLogin();
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    const signal = (service.startLogin.mock.calls[0][1] as { signal: AbortSignal }).signal;
    act(() => result.current.cancel());
    expect(signal.aborted).toBe(true);
    expect(service.cancelLogin).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    expect(popup.close).toHaveBeenCalled();
  });

  it('runs one sign-in at a time, and aborts when the component goes away', () => {
    open.mockReturnValue(null);
    controlledLogin();
    const { result, unmount } = renderHook(() => useKiroSignIn(), { wrapper });
    act(() => result.current.start({ method: 'builder-id' }));
    act(() => result.current.start({ method: 'builder-id' }));
    expect(service.startLogin).toHaveBeenCalledTimes(1);
    const signal = (service.startLogin.mock.calls[0][1] as { signal: AbortSignal }).signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('signs out and stores the new status, or keeps the error', async () => {
    const signedOut: KiroStatus = { state: 'signed-out', path: '~/kiro-cli', version: '3.6.0' };
    service.logout.mockResolvedValueOnce(signedOut);
    const { result } = renderHook(() => useKiroSignIn(), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.signOut();
    });
    expect(ok).toBe(true);
    expect(queryClient.getQueryData(KIRO_STATUS_QUERY_KEY)).toEqual(signedOut);

    service.logout.mockRejectedValueOnce(new Error('Kiro CLI could not sign out'));
    await act(async () => {
      ok = await result.current.signOut();
    });
    expect(ok).toBe(false);
    expect(result.current.signOutError).toBe('Kiro CLI could not sign out');
  });
});
