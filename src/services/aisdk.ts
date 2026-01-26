/**
 * AI SDK Service - Unified provider integration using Vercel AI SDK
 * Supports: Groq, Cerebras, LM Studio (via OpenAI provider)
 */
import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import type { ChatRequest, ModelInfo } from './types';

type AISDKProvider = 'groq' | 'cerebras' | 'lmstudio';

// LM Studio base URL (use proxy in development, direct connection in production)
const LMSTUDIO_BASE_URL = import.meta.env.DEV ? '/api/lmstudio/v1' : 'http://localhost:1234/v1';

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
// LM Studio doesn't require an API key
const API_KEY_STORAGE: Record<Exclude<AISDKProvider, 'lmstudio'>, string> = {
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
    if (this.provider === 'lmstudio') {
      return null; // LM Studio doesn't use API keys
    }
    const key = API_KEY_STORAGE[this.provider];
    return localStorage.getItem(key);
  }

  /**
   * Set the API key in localStorage
   */
  static setApiKey(provider: AISDKProvider, apiKey: string): void {
    if (provider === 'lmstudio') {
      return; // LM Studio doesn't use API keys
    }
    const key = API_KEY_STORAGE[provider];
    localStorage.setItem(key, apiKey);
  }

  /**
   * Remove the API key from localStorage
   */
  static removeApiKey(provider: AISDKProvider): void {
    if (provider === 'lmstudio') {
      return; // LM Studio doesn't use API keys
    }
    const key = API_KEY_STORAGE[provider];
    localStorage.removeItem(key);
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(): boolean {
    // LM Studio doesn't require an API key
    if (this.provider === 'lmstudio') {
      return true;
    }
    const apiKey = this.getApiKey();
    return !!apiKey && apiKey.trim().length > 0;
  }

  /**
   * Create the AI SDK provider instance
   */
  private createProvider() {
    switch (this.provider) {
      case 'groq': {
        const apiKey = this.getApiKey();
        if (!apiKey) {
          throw new Error(`API key not configured for ${this.provider}`);
        }
        return createGroq({ apiKey });
      }
      case 'cerebras': {
        const apiKey = this.getApiKey();
        if (!apiKey) {
          throw new Error(`API key not configured for ${this.provider}`);
        }
        return createCerebras({ apiKey });
      }
      case 'lmstudio':
        // LM Studio doesn't require an API key, uses local server
        return createOpenAI({
          baseURL: LMSTUDIO_BASE_URL,
          apiKey: 'lm-studio', // Required by SDK but not used by LM Studio
        });
      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  /**
   * Get available models for this provider
   */
  getModels(): ModelInfo[] {
    // LM Studio models are fetched dynamically, not hardcoded
    if (this.provider === 'lmstudio') {
      return [];
    }

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
    const startTime = Date.now();

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

      // Stream reasoning tokens first (if available)
      // Note: reasoning is a Promise, not an async iterable
      try {
        const reasoningParts = await result.reasoning;
        if (reasoningParts && reasoningParts.length > 0) {
          yield '__REASONING_START__';
          for (const part of reasoningParts) {
            yield part.text;
          }
          yield '__REASONING_END__';
        }
      } catch {
        // Reasoning may not be available for all models
        console.log(`${this.provider}: No reasoning available`);
      }

      // Stream the text content
      for await (const chunk of result.textStream) {
        yield chunk;
      }

      // Calculate latency
      const latencyMs = Date.now() - startTime;

      // After streaming completes, get usage data
      const usage = await result.usage;
      console.log(`${this.provider}: Usage data:`, usage, `Latency: ${latencyMs}ms`);

      // Yield metadata in the same format as LM Studio for consistency
      yield `__AISDK_METADATA__${JSON.stringify({
        usage: {
          promptTokens: usage?.inputTokens,
          completionTokens: usage?.outputTokens,
          totalTokens: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
        },
        latencyMs,
      })}`;
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
    // LM Studio: Check if server is running
    if (this.provider === 'lmstudio') {
      try {
        const response = await fetch(`${LMSTUDIO_BASE_URL}/models`, {
          method: 'GET',
        });
        return response.ok;
      } catch {
        return false;
      }
    }

    // Groq/Cerebras: Check API key
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
export const lmstudioAISDKService = new AISDKService('lmstudio');
