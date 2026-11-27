/**
 * useAllModels Hook
 *
 * Aggregates models from all available providers for the unified ModelSelector.
 * Fetches models from connected providers and groups them by provider.
 */
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  bedrockService,
  kiroService,
  lmstudioService,
  mantleService,
  ollamaService,
} from '../services';
import { anthropicService, cerebrasService, groqService } from '../services/aisdk';
import type { MantleModelOptions } from '../services/mantle';
import { openrouterService } from '../services/openrouter';
import type { KiroModelMeta, ModelInfo } from '../services/types';
import { PROVIDER_API_KEY_FIELDS } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';
import { kiroStatusQueryOptions } from './useKiroStatus';

export interface UnifiedModel {
  id: string;
  name: string;
  provider: Provider;
  providerName: string;
  family?: string;
  /** The provider reports that the model can think (Ollama) */
  supportsThinking?: boolean;
  /** False when the provider reports that the model cannot use tools (Ollama); unset = unknown */
  supportsTools?: boolean;
  /** Kiro: description, credit rate, and effort levels */
  kiro?: KiroModelMeta;
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
  /**
   * A provider other than Kiro is fetching its models. Kiro can take seconds to start, so it
   * does not hold up the app: wait for `isKiroLoading` too only for a Kiro model.
   */
  isLoading: boolean;
  /** Kiro is fetching its models; the picker shows its group as "Checking…" meanwhile */
  isKiroLoading: boolean;
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
  kiro: 'Kiro',
};

const ALL_MODELS_QUERY_KEY = ['all-models'] as const;
/** The query of Kiro's models; invalidate it to ask Kiro again */
export const KIRO_MODELS_QUERY_KEY = [...ALL_MODELS_QUERY_KEY, 'kiro'] as const;

/** Set when the Kiro status changed, so the next model fetch skips the server cache */
let kiroRefreshPending = false;

function hasConfiguredValue(value?: string): boolean {
  return !!value?.trim();
}

/** Providers whose services return a message that the user can act on */
const PROVIDERS_WITH_OWN_ERRORS: ReadonlySet<Provider> = new Set([
  'lmstudio',
  'bedrock',
  'bedrock-mantle',
  'kiro',
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

  if (provider === 'kiro') return !message.includes('sign in to kiro');

  return true;
}

function getProvidersToFetch(preferences: UserPreferences): Provider[] {
  const providersToFetch: Provider[] = ['bedrock'];

  if (hasConfiguredValue(preferences.bedrockMantleApiKey)) {
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

  // Kiro answers with no models when Kiro CLI is missing, so its group stays hidden
  providersToFetch.push('lmstudio', 'ollama', 'kiro');

  return providersToFetch;
}

type KeyedProvider = 'bedrock-mantle' | 'groq' | 'cerebras' | 'anthropic' | 'openrouter';
type LocalProvider = Exclude<Provider, KeyedProvider | 'kiro'>;

// Functions, not module-level objects: importing the hooks barrel must not read the services,
// so tests that mock '../services' with only some exports still load
const localServices = () =>
  ({
    lmstudio: lmstudioService,
    ollama: ollamaService,
    bedrock: bedrockService,
  }) satisfies Record<LocalProvider, { getModels: () => Promise<ModelInfo[]> }>;

// These take the key (and the Mantle region) from the preferences on each call: the preferences
// are the only store of provider keys
const keyedServices = () =>
  ({
    'bedrock-mantle': mantleService,
    groq: groqService,
    cerebras: cerebrasService,
    anthropic: anthropicService,
    openrouter: openrouterService,
  }) satisfies Record<
    KeyedProvider,
    { getModels: (options: MantleModelOptions) => Promise<ModelInfo[]> }
  >;

const isKeyedProvider = (provider: Provider): provider is KeyedProvider =>
  PROVIDER_API_KEY_FIELDS[provider] !== undefined;

/** The key of the provider (and the Mantle region), read from the preferences argument */
function modelListOptions(
  provider: KeyedProvider,
  preferences: UserPreferences
): MantleModelOptions {
  const field = PROVIDER_API_KEY_FIELDS[provider];
  const apiKey = field ? preferences[field] : undefined;
  return provider === 'bedrock-mantle'
    ? { apiKey, region: preferences.bedrockMantleRegion || 'us-west-2' }
    : { apiKey };
}

function getRawModels(provider: Provider, preferences: UserPreferences, refresh: boolean) {
  if (provider === 'kiro') return kiroService.getModels(refresh);
  if (isKeyedProvider(provider)) {
    return keyedServices()[provider].getModels(modelListOptions(provider, preferences));
  }
  return localServices()[provider].getModels();
}

async function fetchProviderModels(
  provider: Provider,
  preferences: UserPreferences
): Promise<ProviderModels> {
  try {
    const refresh = provider === 'kiro' && kiroRefreshPending;
    if (refresh) kiroRefreshPending = false;
    const rawModels: ModelInfo[] = await getRawModels(provider, preferences, refresh);
    const models: UnifiedModel[] = rawModels.map((model) => ({
      id: model.modelId,
      name: model.modelName,
      provider,
      providerName: PROVIDER_NAMES[provider],
      family: model.modelFamily,
      ...(model.supportsThinking !== undefined && {
        supportsThinking: model.supportsThinking,
      }),
      ...(model.supportsTools !== undefined && { supportsTools: model.supportsTools }),
      ...(model.kiro && { kiro: model.kiro }),
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

  const providersToFetch = getProvidersToFetch(preferences);

  const queries = useQueries({
    queries: providersToFetch.map((provider) => ({
      queryKey: [...ALL_MODELS_QUERY_KEY, provider, keyState],
      queryFn: () => fetchProviderModels(provider, preferences),
    })),
  });

  const queryClient = useQueryClient();

  // Ask Kiro for its models again when it becomes signed in or stops being signed in (sign-in,
  // sign-out, or a status check). This only reads the status that useKiroStatus fetches:
  // `enabled: false` stops this hook from starting a fetch, and the shared options give the query
  // its function.
  const { data: kiroStatus } = useQuery({ ...kiroStatusQueryOptions, enabled: false });
  const kiroSignedIn = kiroStatus ? kiroStatus.state === 'signed-in' : undefined;
  const previousKiroSignedInRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const previous = previousKiroSignedInRef.current;
    previousKiroSignedInRef.current = kiroSignedIn;
    if (previous === undefined || kiroSignedIn === undefined || previous === kiroSignedIn) return;
    kiroRefreshPending = true;
    void queryClient.invalidateQueries({ queryKey: KIRO_MODELS_QUERY_KEY });
  }, [kiroSignedIn, queryClient]);

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
  const isLoading = queries.some(
    (query, index) => query.isFetching && providersToFetch[index] !== 'kiro'
  );
  const isKiroLoading = queries.some(
    (query, index) => query.isFetching && providersToFetch[index] === 'kiro'
  );

  return {
    providers,
    allModels,
    isLoading,
    isKiroLoading,
    refetch: () => {
      void refetch();
    },
  };
}
