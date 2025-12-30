/**
 * Hook for saved prompt CRUD operations
 */
import { useCallback, useState } from 'react';

import { promptsService } from '../services';

interface UsePromptMutationsResult {
  savePrompt: (name: string, content: string, category?: string) => Promise<string>;
  deletePrompt: (id: string) => Promise<void>;
  updatePrompt: (
    id: string,
    updates: { name?: string; content?: string; category?: string }
  ) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}

export function usePromptMutations(): UsePromptMutationsResult {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savePrompt = useCallback(
    async (name: string, content: string, category?: string): Promise<string> => {
      setIsSaving(true);
      setError(null);
      try {
        const id = await promptsService.savePrompt({
          name,
          content,
          category: category || 'default',
        });
        return id;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save prompt';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const deletePrompt = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      await promptsService.deletePrompt(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete prompt';
      setError(message);
      throw err;
    }
  }, []);

  const updatePrompt = useCallback(
    async (
      id: string,
      updates: { name?: string; content?: string; category?: string }
    ): Promise<void> => {
      setIsSaving(true);
      setError(null);
      try {
        await promptsService.updatePrompt(id, updates);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update prompt';
        setError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  return {
    savePrompt,
    deletePrompt,
    updatePrompt,
    isSaving,
    error,
  };
}
