import type { ChatRequest, ModelInfo } from './types';

// Use proxy in development, direct connection in production
const LMSTUDIO_BASE_URL = import.meta.env.DEV ? '/api/lmstudio/v1' : 'http://localhost:1234/v1';

export class LMStudioService {
  private baseUrl: string;

  constructor(baseUrl: string = LMSTUDIO_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getModels(): Promise<ModelInfo[]> {
    try {
      console.log('LMStudio: Fetching from', `${this.baseUrl}/models`);
      const response = await fetch(`${this.baseUrl}/models`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('LMStudio: Raw response:', data);

      if (!data.data || data.data.length === 0) {
        throw new Error(
          'No models loaded in LMStudio. Please either:\n' +
            '1. Load a model in LMStudio (Chat or Developer tab)\n' +
            '2. Enable "JIT Loading" in Developer > Server Settings\n' +
            '   (This allows models to load on-demand via API)'
        );
      }

      const models = data.data
        .filter((model: { id: string }) => !model.id.toLowerCase().includes('embed'))
        .map((model: { id: string }) => ({
          modelId: model.id,
          modelName: model.id,
          provider: 'lmstudio' as const,
        }));

      console.log('LMStudio: Parsed models:', models);
      return models;
    } catch (error) {
      console.error('LMStudio: Failed to fetch models:', error);
      throw error;
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.max_tokens ?? 2048,
          top_p: request.top_p ?? 0.9,
          stream: true,
          stream_options: {
            include_usage: true,
          },
        }),
        signal: request.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
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
            if (data === '[DONE]') {
              console.log('LMStudio: Stream completed with [DONE]');
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              console.log('LMStudio: Parsed chunk:', parsed);

              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }

              // Extract usage information from streaming response
              if (parsed.usage) {
                console.log('LMStudio: Usage data found:', parsed.usage);
                yield `__LMSTUDIO_METADATA__${JSON.stringify({
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  },
                })}`;
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('LMStudio: Chat error:', error);
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const lmstudioService = new LMStudioService();
