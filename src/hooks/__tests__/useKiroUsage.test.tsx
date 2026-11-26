import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import type { KiroStatus } from '../../utils/kiroStatus';
import type { KiroUsage } from '../../utils/kiroUsage';
import { useKiroUsage } from '../useKiroUsage';

const service = vi.hoisted(() => ({ getStatus: vi.fn(), getUsage: vi.fn() }));
vi.mock('../../services', () => ({ kiroService: service }));

const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/kiro-cli',
  version: '3.6.1',
  account: { type: 'builder-id', email: 'a@example.com' },
};
const USAGE: KiroUsage = {
  planName: 'KIRO POWER',
  resetDate: '2026-12-01',
  credits: { used: 1250, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
  overagesEnabled: false,
};

describe('useKiroUsage', () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    client = new QueryClient();
    service.getStatus.mockReset();
    service.getUsage.mockReset().mockResolvedValue(USAGE);
  });

  it('loads the usage when Kiro is signed in', async () => {
    service.getStatus.mockResolvedValue(SIGNED_IN);
    const { result } = renderHook(() => useKiroUsage(), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual(USAGE));
    expect(service.getUsage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ state: 'signed-out', path: 'x', version: '3.6.1' } as KiroStatus],
    [{ state: 'not-installed' } as KiroStatus],
    [{ state: 'unsupported', path: 'x', version: '2.0.0' } as KiroStatus],
    [{ state: 'error', path: 'x', message: 'boom' } as KiroStatus],
  ])('does not ask for the usage when the status is %j', async (status) => {
    service.getStatus.mockResolvedValue(status);
    const { result } = renderHook(() => useKiroUsage(), { wrapper });
    await waitFor(() => expect(service.getStatus).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBeNull());
    expect(service.getUsage).not.toHaveBeenCalled();
  });

  it('does not ask while the status is not known', () => {
    service.getStatus.mockReturnValue(new Promise(() => {}));
    renderHook(() => useKiroUsage(), { wrapper });
    expect(service.getUsage).not.toHaveBeenCalled();
  });

  it('keeps the result for 5 minutes and asks again for another account', async () => {
    service.getStatus.mockResolvedValue(SIGNED_IN);
    const first = renderHook(() => useKiroUsage(), { wrapper });
    await waitFor(() => expect(first.result.current).toEqual(USAGE));
    first.unmount();

    // Same account, mounted again: the 5 minutes have not passed
    const second = renderHook(() => useKiroUsage(), { wrapper });
    await waitFor(() => expect(second.result.current).toEqual(USAGE));
    expect(service.getUsage).toHaveBeenCalledTimes(1);
    second.unmount();

    client.setQueryData(['kiro-status'], {
      ...SIGNED_IN,
      account: { type: 'builder-id', email: 'b@example.com' },
    });
    const third = renderHook(() => useKiroUsage(), { wrapper });
    await waitFor(() => expect(service.getUsage).toHaveBeenCalledTimes(2));
    third.unmount();
  });

  it('is undefined and not null when the call fails, and shows nothing then', async () => {
    service.getStatus.mockResolvedValue(SIGNED_IN);
    service.getUsage.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useKiroUsage(), { wrapper });
    await waitFor(() => expect(service.getUsage).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});
