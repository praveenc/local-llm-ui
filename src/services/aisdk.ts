/**
 * AI SDK Service - Unified provider integration using Vercel AI SDK
 * Supports: Groq, Cerebras (and easily extensible to other AI SDK providers)
 */
import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';

import type { ChatRequest, ModelInfo } from './types';

type AISDKProvider = 'groq' | 'cerebras';

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

// API key storage keys (used directly in localStorage for runtime access)
const API_KEY_STORAGE = {
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
} as const;

// Sync API keys from preferences to localStorage (call on app init or preference change)
export function syncApiKeysFromPreferences(groqApiKey?: string, cerebrasApiKey?: string): void {
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

    const models = this.provider === 'groq' ? GROQ_MODELS : CEREBRAS_MODELS;

    return models.map((model) => ({
      modelId: model.id,
      modelName: model.name,
      provider: this.provider,
    }));
  }

  /**
   * Stream chat completion using AI SDK
   */
  async *chat(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const provider = this.createProvider();

    // Convert messages to AI SDK format
    const messages = request.messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));

    try {
      const result = streamText({
        model: provider(request.model),
        messages,
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        topP: request.top_p,
        abortSignal: request.signal,
      });

      for await (const chunk of result.textStream) {
        yield chunk;
      }
    } catch (error) {
      const err = error as Error;
      console.error(`${this.provider}: Chat error:`, err);
      throw err;
    }
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
