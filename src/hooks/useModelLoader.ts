import { useCallback, useRef, useState } from 'react';

import { lmstudioService } from '../services/lmstudio';

export interface ModelLoaderState {
  isLoading: boolean;
  progress: number;
  message: string;
  error: string | null;
  loadedModel: {
    identifier: string;
    modelPath: string;
    loadTime: number;
  } | null;
}

export interface UseModelLoaderReturn extends ModelLoaderState {
  loadModel: (
    modelPath: string,
    options?: { contextLength?: number; ttl?: number }
  ) => Promise<void>;
  cancelLoading: () => void;
  reset: () => void;
}

const initialState: ModelLoaderState = {
  isLoading: false,
  progress: 0,
  message: '',
  error: null,
  loadedModel: null,
};

export function useModelLoader(): UseModelLoaderReturn {
  const [state, setState] = useState<ModelLoaderState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadModel = useCallback(
    async (modelPath: string, options?: { contextLength?: number; ttl?: number }) => {
      // Cancel any existing loading
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      // Reset state and start loading
      setState({
        isLoading: true,
        progress: 0,
        message: 'Initializing model loading...',
        error: null,
        loadedModel: null,
      });

      try {
        const generator = lmstudioService.loadModelWithProgress(modelPath, {
          ...options,
          signal: abortControllerRef.current.signal,
        });

        for await (const event of generator) {
          // Handle different event types
          switch (event.type) {
            case 'progress':
              setState((prev) => ({
                ...prev,
                progress: event.percentage,
                message: event.message,
              }));
              break;

            case 'log':
              setState((prev) => ({
                ...prev,
                message: event.message,
              }));
              break;

            case 'success':
              setState((prev) => ({
                ...prev,
                isLoading: false,
                progress: 100,
                message: `Model loaded successfully in ${event.loadTime}ms`,
                loadedModel: {
                  identifier: event.identifier,
                  modelPath: event.modelPath,
                  loadTime: event.loadTime,
                },
              }));
              break;

            case 'error':
              setState((prev) => ({
                ...prev,
                isLoading: false,
                error: event.message,
                message: '',
              }));
              break;
          }
        }
      } catch (error) {
        const err = error as Error;

        // Don't set error state if aborted
        if (err.name === 'AbortError') {
          setState(initialState);
          return;
        }

        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err.message || 'Failed to load model',
          message: '',
        }));
      } finally {
        abortControllerRef.current = null;
      }
    },
    []
  );

  const cancelLoading = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(initialState);
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    ...state,
    loadModel,
    cancelLoading,
    reset,
  };
}
