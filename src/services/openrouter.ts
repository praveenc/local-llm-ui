/**
 * OpenRouter Service
 *
 * Client-side service for interacting with OpenRouter endpoints.
 */
import type { ModelInfo } from './types';

const OPENROUTER_BASE_URL = '/api/openrouter';

interface OpenRouterModelsResponse {
  provider?: string;
  models?: Array<{
    id: string;
    name: string;
    /** OpenRouter `architecture.input_modalities`, for example ['text', 'image', 'file'] */
    inputModalities?: string[];
  }>;
}

export class OpenRouterService {
  /** Lists the models with the key from the preferences; no key, no models */
  async getModels({ apiKey }: { apiKey?: string } = {}): Promise<ModelInfo[]> {
    const key = apiKey?.trim();
    if (!key) return [];

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: {
          'X-Api-Key': key,
        },
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as OpenRouterModelsResponse;
      return (data.models || []).map((model) => ({
        modelId: model.id,
        modelName: model.name,
        provider: 'openrouter',
        // Images only for a model that lists the image input (D-A c)
        vision: Array.isArray(model.inputModalities) && model.inputModalities.includes('image'),
      }));
    } catch (error) {
      const err = error as Error;
      console.error('OpenRouter: Failed to fetch models:', error);

      if (err.message?.includes('API key')) {
        throw err;
      }

      throw new Error('Cannot connect to OpenRouter. Please check your API key.', {
        cause: error,
      });
    }
  }
}

export const openrouterService = new OpenRouterService();
