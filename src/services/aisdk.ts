/**
 * AI SDK Service - Unified provider integration using Vercel AI SDK
 * Supports: Groq, Cerebras, Anthropic (and easily extensible to other AI SDK providers)
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';

import type { ModelInfo } from './types';

type AISDKProvider = 'groq' | 'cerebras' | 'anthropic';

// Available models for each provider
const GROQ_MODELS = [
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
   * Set the API key in localStorage
   */
  static setApiKey(provider: AISDKProvider, apiKey: string): void {
    const key = API_KEY_STORAGE[provider];
    localStorage.setItem(key, apiKey);
  }

  /**
   * Remove the API key from localStorage
   */
  static removeApiKey(provider: AISDKProvider): void {
    const key = API_KEY_STORAGE[provider];
    localStorage.removeItem(key);
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(): boolean {
    const apiKey = this.getApiKey();
    return !!apiKey && apiKey.trim().length > 0;
  }

  /**
   * Create the AI SDK provider instance
   */
  private createProvider() {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(`API key not configured for ${this.provider}`);
    }

    switch (this.provider) {
      case 'groq':
        return createGroq({ apiKey });
      case 'cerebras':
        return createCerebras({ apiKey });
      case 'anthropic':
        return createAnthropic({ apiKey });
      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  /**
   * Get available models for this provider
   */
  getModels(): ModelInfo[] {
    // Only return models if API key is configured
    if (!this.hasApiKey()) {
      return [];
    }

    let models: Array<{ id: string; name: string }>;
    switch (this.provider) {
      case 'groq':
        models = GROQ_MODELS;
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

  /**
   * Check if the provider is accessible (API key valid)
   */
  async checkConnection(): Promise<boolean> {
    if (!this.hasApiKey()) {
      return false;
    }

    try {
      // Try to create the provider - this validates the API key format
      this.createProvider();
      // For a full connection check, we'd need to make a test API call
      // but that would consume credits, so we just verify the key exists
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instances for each provider
export const groqService = new AISDKService('groq');
export const cerebrasService = new AISDKService('cerebras');
export const anthropicService = new AISDKService('anthropic');
