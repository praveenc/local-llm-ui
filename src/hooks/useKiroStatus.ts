/**
 * useKiroStatus Hook
 *
 * The state of kiro-cli on the computer that runs the app. The query runs at launch and when the
 * window gets focus again. `refresh` asks the server to check again, without its cache.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCallback, useState } from 'react';

import { kiroService } from '../services';
import type { KiroFolderSetting, KiroStatusResponse } from '../utils/kiroSettings';

export const KIRO_STATUS_QUERY_KEY = ['kiro-status'] as const;

interface UseKiroStatusResult {
  status: KiroStatusResponse | undefined;
  refresh: () => Promise<void>;
  isRefreshing: boolean;
  /** Puts the folder that the server stored into the status, so every view shows it at once */
  setFolder: (folder: KiroFolderSetting) => void;
}

export function useKiroStatus(): UseKiroStatusResult {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data } = useQuery({
    queryKey: KIRO_STATUS_QUERY_KEY,
    queryFn: () => kiroService.getStatus(),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      queryClient.setQueryData(KIRO_STATUS_QUERY_KEY, await kiroService.getStatus(true));
    } catch {
      // Keep the status that is shown
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  const setFolder = useCallback(
    (folder: KiroFolderSetting) => {
      queryClient.setQueryData<KiroStatusResponse>(KIRO_STATUS_QUERY_KEY, (old) =>
        old ? { ...old, folder } : old
      );
    },
    [queryClient]
  );

  return { status: data, refresh, isRefreshing, setFolder };
}
