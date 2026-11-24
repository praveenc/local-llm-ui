/**
 * The light or dark scheme the app draws now. For the 'system' mode it follows the OS
 * setting live; for 'light' and 'dark' it is that mode.
 */
import { useSyncExternalStore } from 'react';

import {
  type ResolvedVisualMode,
  onSystemVisualModeChange,
  systemVisualMode,
} from '../utils/colorThemes';
import type { VisualMode } from '../utils/preferences';

export const useResolvedVisualMode = (mode: VisualMode): ResolvedVisualMode => {
  const system = useSyncExternalStore<ResolvedVisualMode>(
    onSystemVisualModeChange,
    systemVisualMode,
    () => 'light'
  );
  return mode === 'system' ? system : mode;
};
