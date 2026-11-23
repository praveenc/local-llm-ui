/**
 * useAllModels Hook
 *
 * Aggregates models from all available providers for the unified ModelSelector.
 * Fetches models from connected providers and groups them by provider.
 */
import { useQueries, useQueryClient } from '@tanstack/react-query';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { bedrockService, lmstudioService, mantleService, ollamaService } from '../services';
import {
  anthropicService,
  cerebrasService,
  groqService,
  syncApiKeysFromPreferences,
} from '../services/aisdk';
import { openrouterService } from '../services/openrouter';
import { loadPreferences } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';

export interface UnifiedModel {
  id: string;
  name: string;
  provider: Provider;
  providerName: string;
  family?: string;
  /** The provider reports that the model can think (Ollama) */
  supportsThinking?: boolean;
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
  openrouter: 'OpenRouter',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
};

const ALL_MODELS_QUERY_KEY = ['all-models'] as const;

function hasConfiguredValue(value?: string): boolean {
  return !!value?.trim();
}

/** Providers whose services return a message that the user can act on */
const PROVIDERS_WITH_OWN_ERRORS: ReadonlySet<Provider> = new Set([
  'lmstudio',
  'bedrock',
  'bedrock-mantle',
]);

function getProviderErrorMessage(provider: Provider, err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message && PROVIDERS_WITH_OWN_ERRORS.has(provider)) return message;
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

  if (hasConfiguredValue(preferences.openrouterApiKey)) {
    providersToFetch.push('openrouter');
  }

  providersToFetch.push('lmstudio', 'ollama');

  return providersToFetch;
}

/** Point the services at the keys and region saved in preferences */
function configureServices(preferences: UserPreferences) {
  syncApiKeysFromPreferences(
    preferences.groqApiKey,
    preferences.cerebrasApiKey,
    preferences.anthropicApiKey
  );
  const currentPrefs = loadPreferences();
  mantleService.setApiKey(currentPrefs.bedrockMantleApiKey || null);
  mantleService.setRegion(currentPrefs.bedrockMantleRegion || 'us-west-2');
  openrouterService.setApiKey(currentPrefs.openrouterApiKey || null);
}

// A function, not a module-level object: importing the hooks barrel must not read the services,
// so tests that mock '../services' with only some exports still load
const servicesByProvider = () =>
  ({
    lmstudio: lmstudioService,
    ollama: ollamaService,
    bedrock: bedrockService,
    'bedrock-mantle': mantleService,
    groq: groqService,
    cerebras: cerebrasService,
    anthropic: anthropicService,
    openrouter: openrouterService,
  }) satisfies Record<Provider, { getModels: () => Promise<unknown[]> }>;

async function fetchProviderModels(
  provider: Provider,
  preferences: UserPreferences
): Promise<ProviderModels> {
  configureServices(preferences);
  try {
    const rawModels = await servicesByProvider()[provider].getModels();
    const models: UnifiedModel[] = rawModels.map((model) => ({
      id: model.modelId,
      name: model.modelName,
      provider,
      providerName: PROVIDER_NAMES[provider],
      family: model.modelFamily,
      ...(model.supportsThinking !== undefined && {
        supportsThinking: model.supportsThinking,
      }),
    }));
    return { provider, providerName: PROVIDER_NAMES[provider], models, status: 'success' };
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
}

/**
 * Each provider is probed in its own query, so a fast provider shows its models (and a slow one
 * shows "Checking...") instead of the whole list waiting for the slowest probe.
 */
export function useAllModels(preferences: UserPreferences): UseAllModelsResult {
  const keyState = useMemo(
    () => ({
      bedrockMantleEnabled: hasConfiguredValue(preferences.bedrockMantleApiKey),
      bedrockMantleRegion: preferences.bedrockMantleRegion || 'us-west-2',
      groqEnabled: hasConfiguredValue(preferences.groqApiKey),
      cerebrasEnabled: hasConfiguredValue(preferences.cerebrasApiKey),
      anthropicEnabled: hasConfiguredValue(preferences.anthropicApiKey),
      openrouterEnabled: hasConfiguredValue(preferences.openrouterApiKey),
    }),
    [
      preferences.anthropicApiKey,
      preferences.bedrockMantleApiKey,
      preferences.bedrockMantleRegion,
      preferences.cerebrasApiKey,
      preferences.groqApiKey,
      preferences.openrouterApiKey,
    ]
  );

  const providersToFetch = getProvidersToFetch(preferences, loadPreferences());

  const queries = useQueries({
    queries: providersToFetch.map((provider) => ({
      queryKey: [...ALL_MODELS_QUERY_KEY, provider, keyState],
      queryFn: () => fetchProviderModels(provider, preferences),
    })),
  });

  const queryClient = useQueryClient();
  const refetch = useCallback(
    () => queryClient.refetchQueries({ queryKey: ALL_MODELS_QUERY_KEY, type: 'active' }),
    [queryClient]
  );

  // The query key only tracks whether a key is set. Refetch when a key's value changes too
  // (the user replaced a key), so the new key is used right away.
  const apiKeys = [
    preferences.bedrockMantleApiKey,
    preferences.groqApiKey,
    preferences.cerebrasApiKey,
    preferences.anthropicApiKey,
    preferences.openrouterApiKey,
  ].join('\u0000');
  const previousApiKeysRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousApiKeysRef.current;
    previousApiKeysRef.current = apiKeys;
    if (previous !== null && previous !== apiKeys) void refetch();
  }, [apiKeys, refetch]);

  const providers: ProviderModels[] = queries
    .map((query, index): ProviderModels => {
      const provider = providersToFetch[index];
      if (query.isFetching || !query.data) {
        return {
          provider,
          providerName: PROVIDER_NAMES[provider],
          models: [],
          status: 'loading',
        };
      }
      return query.data;
    })
    // A provider that answered with no models has nothing to show
    .filter((provider) => provider.status !== 'success' || provider.models.length > 0);
  const allModels = providers.flatMap((provider) => provider.models);
  const isLoading = queries.some((query) => query.isFetching);

  return {
    providers,
    allModels,
    isLoading,
    refetch: () => {
      void refetch();
    },
  };
}
