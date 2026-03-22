/**
 * useAllModels Hook
 *
 * Aggregates models from all available providers for the unified ModelSelector.
 * Fetches models from connected providers and groups them by provider.
 */
import { useQuery } from '@tanstack/react-query';

import { useEffect, useMemo, useRef } from 'react';

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

const ALL_MODELS_QUERY_KEY = ['all-models'] as const;

function hasConfiguredValue(value?: string): boolean {
  return !!value?.trim();
}

function getProviderErrorMessage(provider: Provider, err: unknown): string {
  const message = err instanceof Error ? err.message : '';

  if (provider === 'lmstudio' && message) {
    return message;
  }

  if (provider === 'bedrock' && message) {
    return message;
  }

  if (provider === 'bedrock-mantle' && message) {
    return message;
  }

  return `Cannot connect to ${PROVIDER_NAMES[provider]}`;
}

function shouldLogProviderError(provider: Provider, err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';

  if (provider === 'lmstudio') {
    return !(
      message.includes('cannot connect to lm studio') ||
      message.includes('lm studio is not connected') ||
      message.includes('no models available in lmstudio')
    );
  }

  if (provider === 'bedrock') {
    return !(message.includes('aws credentials') || message.includes('access denied'));
  }

  return true;
}

function getProvidersToFetch(
  preferences: UserPreferences,
  storedPreferences: UserPreferences = preferences
): Provider[] {
  const providersToFetch: Provider[] = ['bedrock'];

  if (hasConfiguredValue(storedPreferences.bedrockMantleApiKey)) {
    providersToFetch.push('bedrock-mantle');
  }

  if (hasConfiguredValue(preferences.groqApiKey)) {
    providersToFetch.push('groq');
  }

  if (hasConfiguredValue(preferences.cerebrasApiKey)) {
    providersToFetch.push('cerebras');
  }

  if (hasConfiguredValue(preferences.anthropicApiKey)) {
    providersToFetch.push('anthropic');
  }

  providersToFetch.push('lmstudio', 'ollama');

  return providersToFetch;
}

function createLoadingProviders(providersToFetch: Provider[]): ProviderModels[] {
  return providersToFetch.map((provider) => ({
    provider,
    providerName: PROVIDER_NAMES[provider],
    models: [],
    status: 'loading' as const,
  }));
}

export function useAllModels(preferences: UserPreferences): UseAllModelsResult {
  const queryKey = useMemo(
    () => [
      ...ALL_MODELS_QUERY_KEY,
      {
        bedrockMantleEnabled: hasConfiguredValue(preferences.bedrockMantleApiKey),
        bedrockMantleRegion: preferences.bedrockMantleRegion || 'us-west-2',
        groqEnabled: hasConfiguredValue(preferences.groqApiKey),
        cerebrasEnabled: hasConfiguredValue(preferences.cerebrasApiKey),
        anthropicEnabled: hasConfiguredValue(preferences.anthropicApiKey),
      },
    ],
    [
      preferences.anthropicApiKey,
      preferences.bedrockMantleApiKey,
      preferences.bedrockMantleRegion,
      preferences.cerebrasApiKey,
      preferences.groqApiKey,
    ]
  );

  const loadingProviders = useMemo(
    () => createLoadingProviders(getProvidersToFetch(preferences)),
    [preferences]
  );

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<ProviderModels[]> => {
      syncApiKeysFromPreferences(
        preferences.groqApiKey,
        preferences.cerebrasApiKey,
        preferences.anthropicApiKey
      );

      const { lmstudioService, ollamaService, bedrockService, mantleService } =
        await import('../services');

      const currentPrefs = loadPreferences();
      const providersToFetch = getProvidersToFetch(preferences, currentPrefs);

      if (currentPrefs.bedrockMantleApiKey) {
        mantleService.setApiKey(currentPrefs.bedrockMantleApiKey);
        mantleService.setRegion(currentPrefs.bedrockMantleRegion || 'us-west-2');
      } else {
        mantleService.setApiKey(null);
        mantleService.setRegion(currentPrefs.bedrockMantleRegion || 'us-west-2');
      }

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
                rawModels = await groqService.getModels();
                break;
              case 'cerebras':
                rawModels = await cerebrasService.getModels();
                break;
              case 'anthropic':
                rawModels = await anthropicService.getModels();
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
            if (shouldLogProviderError(provider, err)) {
              console.error(`Failed to fetch ${provider} models:`, err);
            }

            return {
              provider,
              providerName: PROVIDER_NAMES[provider],
              models: [],
              status: 'error',
              error: getProviderErrorMessage(provider, err),
            };
          }
        })
      );

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

      return finalProviders.filter(
        (provider) => provider.models.length > 0 || provider.status === 'error'
      );
    },
  });

  const { data, isFetching, refetch } = query;

  const previousSecretsRef = useRef<{
    bedrockMantleApiKey?: string;
    bedrockMantleEnabled: boolean;
    bedrockMantleRegion: string;
    groqApiKey?: string;
    groqEnabled: boolean;
    cerebrasApiKey?: string;
    cerebrasEnabled: boolean;
    anthropicApiKey?: string;
    anthropicEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    const currentSecrets = {
      bedrockMantleApiKey: preferences.bedrockMantleApiKey,
      bedrockMantleEnabled: hasConfiguredValue(preferences.bedrockMantleApiKey),
      bedrockMantleRegion: preferences.bedrockMantleRegion || 'us-west-2',
      groqApiKey: preferences.groqApiKey,
      groqEnabled: hasConfiguredValue(preferences.groqApiKey),
      cerebrasApiKey: preferences.cerebrasApiKey,
      cerebrasEnabled: hasConfiguredValue(preferences.cerebrasApiKey),
      anthropicApiKey: preferences.anthropicApiKey,
      anthropicEnabled: hasConfiguredValue(preferences.anthropicApiKey),
    };

    const previousSecrets = previousSecretsRef.current;
    previousSecretsRef.current = currentSecrets;

    if (!previousSecrets) {
      return;
    }

    const secretValuesChanged =
      previousSecrets.bedrockMantleApiKey !== currentSecrets.bedrockMantleApiKey ||
      previousSecrets.groqApiKey !== currentSecrets.groqApiKey ||
      previousSecrets.cerebrasApiKey !== currentSecrets.cerebrasApiKey ||
      previousSecrets.anthropicApiKey !== currentSecrets.anthropicApiKey;

    if (secretValuesChanged) {
      void refetch();
    }
  }, [
    preferences.anthropicApiKey,
    preferences.bedrockMantleApiKey,
    preferences.bedrockMantleRegion,
    preferences.cerebrasApiKey,
    preferences.groqApiKey,
    refetch,
  ]);

  const providers = isFetching ? loadingProviders : (data ?? []);
  const allModels = providers.flatMap((provider) => provider.models);
  const isLoading = isFetching;

  return {
    providers,
    allModels,
    isLoading,
    refetch: () => {
      void refetch();
    },
  };
}
