/**
 * OpenRouter Service
 *
 * Client-side service for interacting with OpenRouter endpoints.
 */
import type { ModelInfo } from './types';

const OPENROUTER_BASE_URL = '/api/openrouter';
const OPENROUTER_API_KEY_STORAGE = 'OPENROUTER_API_KEY';

interface OpenRouterModelsResponse {
  provider?: string;
  models?: Array<{
    id: string;
    name: string;
  }>;
}

export class OpenRouterService {
  setApiKey(apiKey: string | null): void {
    const trimmed = apiKey?.trim();
    if (trimmed && trimmed.length > 0) {
      localStorage.setItem(OPENROUTER_API_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(OPENROUTER_API_KEY_STORAGE);
    }
  }

  getApiKey(): string | null {
    return localStorage.getItem(OPENROUTER_API_KEY_STORAGE);
  }

  hasApiKey(): boolean {
    const apiKey = this.getApiKey();
    return !!apiKey && apiKey.trim().length > 0;
  }

  async getModels(): Promise<ModelInfo[]> {
    if (!this.hasApiKey()) {
      throw new Error('OpenRouter API key is required. Please configure it in the preferences.');
    }

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: {
          'X-Api-Key': this.getApiKey()!,
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
      }));
    } catch (error) {
      const err = error as Error;
      console.error('OpenRouter: Failed to fetch models:', error);

      if (err.message?.includes('API key')) {
        throw err;
      }

      throw new Error('Cannot connect to OpenRouter. Please check your API key.');
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.hasApiKey()) {
      return false;
    }

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: {
          'X-Api-Key': this.getApiKey()!,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const openrouterService = new OpenRouterService();
