/**
 * Model discovery for the AI SDK providers: Groq, Cerebras, and Anthropic. Each lists its models
 * through /api/aisdk/models, with a static list when that fails.
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

// The 4 latest models, used when Anthropic's own list cannot be fetched
const ANTHROPIC_MODELS_FALLBACK = [
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
];

/** The key of the provider, from the preferences (the only store of provider keys) */
export interface ApiKeyOptions {
  apiKey?: string;
}

interface ProviderModelResponse {
  models?: Array<{
    id: string;
    /** Display name, when the provider gives one (Anthropic) */
    name?: string;
    ownedBy?: string;
  }>;
}

export class AISDKService {
  private provider: AISDKProvider;

  constructor(provider: AISDKProvider) {
    this.provider = provider;
  }

  private async fetchRemoteModels(apiKey: string): Promise<ModelInfo[]> {
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
      modelName: model.name?.trim() ? model.name : model.id,
      provider: this.provider,
      ownedBy: model.ownedBy,
    }));
  }

  /**
   * Get available models for this provider
   */
  async getModels({ apiKey }: ApiKeyOptions = {}): Promise<ModelInfo[]> {
    // Only return models if API key is configured
    const key = apiKey?.trim();
    if (!key) {
      return [];
    }

    // All three providers list their models at runtime through the proxy
    try {
      return await this.fetchRemoteModels(key);
    } catch (error) {
      console.warn(`Failed to fetch ${this.provider} models remotely, using fallback:`, error);
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
        models = ANTHROPIC_MODELS_FALLBACK;
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
