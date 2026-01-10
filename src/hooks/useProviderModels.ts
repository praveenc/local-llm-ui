import { useEffect, useState } from 'react';

import { cerebrasService, groqService, syncApiKeysFromPreferences } from '../services/aisdk';
import { loadPreferences } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';

export interface ModelOption {
  label: string;
  value: string;
  description?: string;
  group?: string;
}

export interface ModelGroup {
  label: string;
  options: ModelOption[];
}

type LoadingStatus = 'pending' | 'loading' | 'error' | 'finished';

interface UseProviderModelsResult {
  models: (ModelOption | ModelGroup)[];
  status: LoadingStatus;
  error: string | null;
  refetch: () => void;
}

export function useProviderModels(
  provider: Provider,
  preferences: UserPreferences
): UseProviderModelsResult {
  const [models, setModels] = useState<(ModelOption | ModelGroup)[]>([]);
  const [status, setStatus] = useState<LoadingStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = () => setRefetchTrigger((prev) => prev + 1);

  useEffect(() => {
    const fetchModels = async () => {
      setStatus('loading');
      setError(null);

      try {
        // Sync AI SDK API keys
        syncApiKeysFromPreferences(preferences.groqApiKey, preferences.cerebrasApiKey);

        const { lmstudioService, ollamaService, bedrockService, mantleService } =
          await import('../services');

        // Configure Mantle if needed
        if (provider === 'bedrock-mantle') {
          const currentPrefs = loadPreferences();
          if (!currentPrefs.bedrockMantleApiKey) {
            setError('Bedrock API key required. Configure in preferences.');
            setStatus('error');
            setModels([]);
            return;
          }
          mantleService.setApiKey(currentPrefs.bedrockMantleApiKey);
          mantleService.setRegion(currentPrefs.bedrockMantleRegion || 'us-west-2');
        }

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
          default:
            throw new Error('Invalid provider');
        }

        // Format models - group Bedrock by family
        if (provider === 'bedrock') {
          const modelsByFamily = rawModels.reduce(
            (acc, model) => {
              const family = model.modelFamily || 'Other';
              if (!acc[family]) acc[family] = [];
              acc[family].push({
                label: model.modelName,
                value: model.modelId,
                description: model.provider,
              });
              return acc;
            },
            {} as Record<string, ModelOption[]>
          );

          const sortedFamilies = Object.keys(modelsByFamily).sort((a, b) => {
            if (a === 'Anthropic Claude') return -1;
            if (b === 'Anthropic Claude') return 1;
            return a.localeCompare(b);
          });

          const grouped: ModelGroup[] = sortedFamilies.map((family) => ({
            label: family,
            options: modelsByFamily[family],
          }));

          setModels(grouped);
        } else {
          const flat: ModelOption[] = rawModels.map((model) => ({
            label: model.modelName,
            value: model.modelId,
            description: model.provider,
          }));
          setModels(flat);
        }

        setStatus('finished');
      } catch (err) {
        console.error(`Failed to fetch ${provider} models:`, err);
        const errorMessages: Record<Provider, string> = {
          lmstudio: 'Cannot connect to LM Studio (port 1234)',
          ollama: 'Cannot connect to Ollama (port 11434)',
          bedrock: 'Cannot connect to Amazon Bedrock. Check AWS credentials.',
          'bedrock-mantle': 'Cannot connect to Bedrock Mantle. Check API key.',
          groq: 'Cannot connect to Groq. Check API key.',
          cerebras: 'Cannot connect to Cerebras. Check API key.',
        };
        setError(errorMessages[provider] || 'Connection failed');
        setStatus('error');
        setModels([]);
      }
    };

    fetchModels();
  }, [
    provider,
    preferences.bedrockMantleApiKey,
    preferences.bedrockMantleRegion,
    preferences.groqApiKey,
    preferences.cerebrasApiKey,
    refetchTrigger,
  ]);

  return { models, status, error, refetch };
}
