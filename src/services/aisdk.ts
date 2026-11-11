/**
 * Model discovery for the AI SDK providers: Groq, Cerebras, and Anthropic.
 *
 * The chat itself goes through the server proxies (see server/aisdk-proxy.ts and
 * server/anthropic-aisdk-proxy.ts). The browser only lists models here.
 */
import type { ModelInfo } from './types';

type AISDKProvider = 'groq' | 'cerebras' | 'anthropic';

// Static fallback models when remote discovery is unavailable
const GROQ_MODELS_FALLBACK = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
  { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B Versatile' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
];

const CEREBRAS_MODELS = [
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B' },
  { id: 'llama3.1-8b', name: 'Llama 3.1 8B' },
];

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Legacy)' },
];

// API key storage keys (used directly in localStorage for runtime access)
const API_KEY_STORAGE = {
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const;

// Sync API keys from preferences to localStorage (call on app init or preference change)
export function syncApiKeysFromPreferences(
  groqApiKey?: string,
  cerebrasApiKey?: string,
  anthropicApiKey?: string
): void {
  if (groqApiKey) {
    localStorage.setItem(API_KEY_STORAGE.groq, groqApiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE.groq);
  }
  if (cerebrasApiKey) {
    localStorage.setItem(API_KEY_STORAGE.cerebras, cerebrasApiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE.cerebras);
  }
  if (anthropicApiKey) {
    localStorage.setItem(API_KEY_STORAGE.anthropic, anthropicApiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE.anthropic);
  }
}

interface ProviderModelResponse {
  models?: Array<{
    id: string;
    ownedBy?: string;
  }>;
}

export class AISDKService {
  private provider: AISDKProvider;

  constructor(provider: AISDKProvider) {
    this.provider = provider;
  }

  /**
   * Get the API key from localStorage
   */
  private getApiKey(): string | null {
    const key = API_KEY_STORAGE[this.provider];
    return localStorage.getItem(key);
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(): boolean {
    const apiKey = this.getApiKey();
    return !!apiKey && apiKey.trim().length > 0;
  }

  private async fetchRemoteModels(): Promise<ModelInfo[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(`API key not configured for ${this.provider}`);
    }

    const response = await fetch(`/api/aisdk/models?provider=${this.provider}`, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorData.error || `Failed to fetch ${this.provider} models`);
    }

    const data = (await response.json()) as ProviderModelResponse;
    if (!Array.isArray(data.models)) {
      throw new Error(`Invalid ${this.provider} models response`);
    }

    return data.models.map((model) => ({
      modelId: model.id,
      modelName: model.id,
      provider: this.provider,
      ownedBy: model.ownedBy,
    }));
  }

  /**
   * Get available models for this provider
   */
  async getModels(): Promise<ModelInfo[]> {
    // Only return models if API key is configured
    if (!this.hasApiKey()) {
      return [];
    }

    // Groq and Cerebras support runtime model discovery via proxy
    if (this.provider === 'groq' || this.provider === 'cerebras') {
      try {
        return await this.fetchRemoteModels();
      } catch (error) {
        console.warn(`Failed to fetch ${this.provider} models remotely, using fallback:`, error);
      }
    }

    let models: Array<{ id: string; name: string }>;
    switch (this.provider) {
      case 'groq':
        models = GROQ_MODELS_FALLBACK;
        break;
      case 'cerebras':
        models = CEREBRAS_MODELS;
        break;
      case 'anthropic':
        models = ANTHROPIC_MODELS;
        break;
      default:
        models = [];
    }

    return models.map((model) => ({
      modelId: model.id,
      modelName: model.name,
      provider: this.provider,
    }));
  }
}

// Export singleton instances for each provider
export const groqService = new AISDKService('groq');
export const cerebrasService = new AISDKService('cerebras');
export const anthropicService = new AISDKService('anthropic');
