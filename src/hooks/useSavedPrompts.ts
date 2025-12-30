/**
 * Hook for listing saved prompts with live query
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../db';
import type { SavedPrompt } from '../db';

interface UseSavedPromptsResult {
  prompts: SavedPrompt[];
  categories: string[];
  isLoading: boolean;
}

export function useSavedPrompts(): UseSavedPromptsResult {
  const prompts = useLiveQuery(
    async () => db.savedPrompts.orderBy('createdAt').reverse().toArray(),
    [],
    []
  );

  const categories = useLiveQuery(
    async () => {
      const allPrompts = await db.savedPrompts.toArray();
      const cats = new Set(allPrompts.map((p) => p.category));
      return Array.from(cats).sort();
    },
    [],
    []
  );

  const isLoading = prompts === undefined || categories === undefined;

  return {
    prompts: prompts ?? [],
    categories: categories ?? [],
    isLoading,
  };
}
