/**
 * useAllModels Hook
 *
 * Aggregates models from all available providers for the unified ModelSelector.
 * Fetches models from connected providers and groups them by provider.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  anthropicService,
  cerebrasService,
  groqService,
  syncApiKeysFromPreferences,
} from '../services/aisdk';
import { loadPreferences } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';

export interface UnifiedModel {
  id: string;
  name: string;
  provider: Provider;
  providerName: string;
  family?: string;
}

export interface ProviderModels {
  provider: Provider;
  providerName: string;
  models: UnifiedModel[];
  status: 'loading' | 'success' | 'error';
  error?: string;
}

interface UseAllModelsResult {
  providers: ProviderModels[];
  allModels: UnifiedModel[];
  isLoading: boolean;
  refetch: () => void;
}

const PROVIDER_NAMES: Record<Provider, string> = {
  bedrock: 'Amazon Bedrock',
  'bedrock-mantle': 'Bedrock Mantle',
  groq: 'Groq',
  cerebras: 'Cerebras',
  anthropic: 'Anthropic',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
};

export function useAllModels(preferences: UserPreferences): UseAllModelsResult {
  const [providers, setProviders] = useState<ProviderModels[]>([]);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => setRefetchTrigger((prev) => prev + 1), []);

  useEffect(() => {
    const fetchAllModels = async () => {
      // Sync AI SDK API keys
      syncApiKeysFromPreferences(
        preferences.groqApiKey,
        preferences.cerebrasApiKey,
        preferences.anthropicApiKey
      );

      const { lmstudioService, ollamaService, bedrockService, mantleService } =
        await import('../services');

      // Define which providers to fetch based on configuration
      const providersToFetch: Provider[] = [];

      // Always try Bedrock (uses AWS credentials)
      providersToFetch.push('bedrock');

      // Bedrock Mantle if API key is configured
      const currentPrefs = loadPreferences();
      if (currentPrefs.bedrockMantleApiKey) {
        mantleService.setApiKey(currentPrefs.bedrockMantleApiKey);
        mantleService.setRegion(currentPrefs.bedrockMantleRegion || 'us-west-2');
        providersToFetch.push('bedrock-mantle');
      }

      // Groq if API key is configured
      if (preferences.groqApiKey) {
        providersToFetch.push('groq');
      }

      // Cerebras if API key is configured
      if (preferences.cerebrasApiKey) {
        providersToFetch.push('cerebras');
      }

      // Anthropic if API key is configured
      if (preferences.anthropicApiKey) {
        providersToFetch.push('anthropic');
      }

      // Always try local providers
      providersToFetch.push('lmstudio', 'ollama');

      // Initialize all providers as loading
      const initialProviders: ProviderModels[] = providersToFetch.map((provider) => ({
        provider,
        providerName: PROVIDER_NAMES[provider],
        models: [],
        status: 'loading' as const,
      }));
      setProviders(initialProviders);

      // Fetch models from each provider in parallel
      const results = await Promise.allSettled(
        providersToFetch.map(async (provider): Promise<ProviderModels> => {
          try {
            let rawModels;
            switch (provider) {
              case 'lmstudio':
                rawModels = await lmstudioService.getModels();
                break;
              case 'ollama':
                rawModels = await ollamaService.getModels();
                break;
              case 'bedrock':
                rawModels = await bedrockService.getModels();
                break;
              case 'bedrock-mantle':
                rawModels = await mantleService.getModels();
                break;
              case 'groq':
                rawModels = groqService.getModels();
                break;
              case 'cerebras':
                rawModels = cerebrasService.getModels();
                break;
              case 'anthropic':
                rawModels = anthropicService.getModels();
                break;
              default:
                throw new Error('Invalid provider');
            }

            const models: UnifiedModel[] = rawModels.map((model) => ({
              id: model.modelId,
              name: model.modelName,
              provider,
              providerName: PROVIDER_NAMES[provider],
              family: model.modelFamily,
            }));

            return {
              provider,
              providerName: PROVIDER_NAMES[provider],
              models,
              status: 'success',
            };
          } catch (err) {
            console.error(`Failed to fetch ${provider} models:`, err);
            return {
              provider,
              providerName: PROVIDER_NAMES[provider],
              models: [],
              status: 'error',
              error: `Cannot connect to ${PROVIDER_NAMES[provider]}`,
            };
          }
        })
      );

      // Process results
      const finalProviders: ProviderModels[] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        return {
          provider: providersToFetch[index],
          providerName: PROVIDER_NAMES[providersToFetch[index]],
          models: [],
          status: 'error' as const,
          error: 'Failed to fetch models',
        };
      });

      // Filter out providers with no models and no errors (not configured)
      const activeProviders = finalProviders.filter(
        (p) => p.models.length > 0 || p.status === 'error'
      );

      setProviders(activeProviders);
    };

    fetchAllModels();
  }, [
    preferences.bedrockMantleApiKey,
    preferences.bedrockMantleRegion,
    preferences.groqApiKey,
    preferences.cerebrasApiKey,
    preferences.anthropicApiKey,
    refetchTrigger,
  ]);

  // Flatten all models for easy access
  const allModels = providers.flatMap((p) => p.models);
  const isLoading = providers.some((p) => p.status === 'loading');

  return { providers, allModels, isLoading, refetch };
}
