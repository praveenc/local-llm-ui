/**
 * Hook for listing saved prompts with live query
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { useMemo } from 'react';

import { db } from '../db';
import type { SavedPrompt } from '../db';

interface UseSavedPromptsResult {
  prompts: SavedPrompt[];
  categories: string[];
  /** True until the first read of the database has returned */
  isLoading: boolean;
}

// One stable empty list, so a consumer's memo does not re-run on each render while loading
const NO_PROMPTS: SavedPrompt[] = [];

export function useSavedPrompts(): UseSavedPromptsResult {
  // No default result: `undefined` means that the first read has not returned yet
  const result = useLiveQuery(
    async () => db.savedPrompts.orderBy('createdAt').reverse().toArray(),
    []
  );

  const categories = useMemo(
    () => Array.from(new Set((result ?? NO_PROMPTS).map((p) => p.category))).sort(),
    [result]
  );

  return {
    prompts: result ?? NO_PROMPTS,
    categories,
    isLoading: result === undefined,
  };
}
