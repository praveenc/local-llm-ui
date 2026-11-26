/**
 * useKiroUsage Hook
 *
 * The plan and the credits of the Kiro account. The query runs only when Kiro is signed in. The
 * server keeps the result 5 minutes, and so does the query. The data is null when Kiro cannot
 * tell or is not signed in, and undefined while the status or the first answer is on its way.
 */
import { useQuery } from '@tanstack/react-query';

import { kiroService } from '../services';
import type { KiroUsage } from '../utils/kiroUsage';
import { useKiroStatus } from './useKiroStatus';

export const KIRO_USAGE_QUERY_KEY = ['kiro-usage'] as const;

export function useKiroUsage(): KiroUsage | null | undefined {
  const { status } = useKiroStatus();
  const signedIn = status?.state === 'signed-in';
  // The account is in the key: another account must not show the credits of the last one
  const account =
    status?.state === 'signed-in' ? `${status.account.type}:${status.account.email ?? ''}` : '';

  const { data } = useQuery({
    queryKey: [...KIRO_USAGE_QUERY_KEY, account],
    queryFn: () => kiroService.getUsage(),
    enabled: signedIn,
    staleTime: 300_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  // Undefined until the status is known, null when Kiro is not signed in
  if (!status) return undefined;
  return signedIn ? data : null;
}
