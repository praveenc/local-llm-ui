/**
 * Bedrock Mantle Service
 *
 * Client-side service for interacting with Amazon Bedrock Mantle endpoints
 * which provide OpenAI-compatible APIs.
 */
import type { ChatRequest, ModelInfo } from './types';

const MANTLE_BASE_URL = '/api/mantle';

export interface MantleRegion {
  id: string;
  name: string;
  endpoint: string;
}

export class MantleService {
  private apiKey: string | null = null;
  private region: string = 'us-west-2';

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey;
  }

  setRegion(region: string): void {
    this.region = region;
  }

  getApiKey(): string | null {
    return this.apiKey;
  }

  getRegion(): string {
    return this.region;
  }

  hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  async getRegions(): Promise<MantleRegion[]> {
    try {
      const response = await fetch(`${MANTLE_BASE_URL}/regions`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.regions || [];
    } catch (error) {
      console.error('Mantle: Failed to fetch regions:', error);
      throw new Error('Failed to fetch Mantle regions');
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    if (!this.hasApiKey()) {
      throw new Error(
        'Bedrock Mantle API key is required. Please configure it in the preferences.'
      );
    }

    try {
      const response = await fetch(`${MANTLE_BASE_URL}/models`, {
        headers: {
          'X-Mantle-Api-Key': this.apiKey!,
          'X-Mantle-Region': this.region,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Mantle: Received ${data.models?.length || 0} models from ${this.region}`);

      return data.models || [];
    } catch (error) {
      const err = error as Error;
      console.error('Mantle: Failed to fetch models:', error);

      if (err.message?.includes('API key')) {
        throw err;
      }

      throw new Error(
        `Cannot connect to Bedrock Mantle in ${this.region}. Please check your API key.`
      );
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    if (!this.hasApiKey()) {
      throw new Error(
        'Bedrock Mantle API key is required. Please configure it in the preferences.'
      );
    }

    try {
      const response = await fetch(`${MANTLE_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mantle-Api-Key': this.apiKey!,
          'X-Mantle-Region': this.region,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((msg) => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          })),
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          top_p: request.top_p,
          stream: true,
        }),
        signal: request.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                yield parsed.content;
              } else if (parsed.metadata) {
                // Yield metadata as a special marker
                yield `__MANTLE_METADATA__${JSON.stringify(parsed.metadata)}`;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      console.error('Mantle: Chat error:', error);
      throw err;
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.hasApiKey()) {
      return false;
    }

    try {
      const response = await fetch(`${MANTLE_BASE_URL}/models`, {
        headers: {
          'X-Mantle-Api-Key': this.apiKey!,
          'X-Mantle-Region': this.region,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const mantleService = new MantleService();
