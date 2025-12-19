/**
 * Custom hook for managing prompt optimization state
 */
import { useCallback, useRef, useState } from 'react';

import { type OptimizePromptResult, optimizePrompt } from '../services/promptOptimizer';

interface UsePromptOptimizerReturn {
  isOptimizing: boolean;
  error: string | null;
  optimize: (prompt: string) => Promise<OptimizePromptResult>;
  cancel: () => void;
  clearError: () => void;
}

/**
 * Hook to manage prompt optimization with cancellation support
 */
export function usePromptOptimizer(): UsePromptOptimizerReturn {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const optimize = useCallback(async (prompt: string): Promise<OptimizePromptResult> => {
    // Cancel any existing optimization
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    setIsOptimizing(true);
    setError(null);

    try {
      const result = await optimizePrompt(prompt, {
        signal: abortControllerRef.current.signal,
      });

      if (!result.success && result.error) {
        setError(result.error);
      }

      return result;
    } finally {
      setIsOptimizing(false);
      abortControllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsOptimizing(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isOptimizing,
    error,
    optimize,
    cancel,
    clearError,
  };
}
