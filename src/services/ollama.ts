import type { ChatRequest, ModelInfo } from './types';

// Use proxy in development, direct connection in production
const OLLAMA_BASE_URL = import.meta.env.DEV ? '/api/ollama' : 'http://localhost:11434';

export class OllamaService {
  private baseUrl: string;

  constructor(baseUrl: string = OLLAMA_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      return data.models
        .filter((model: { name: string }) => !model.name.toLowerCase().includes('embed'))
        .map((model: { name: string }) => ({
          modelId: model.name,
          modelName: model.name,
          provider: 'ollama' as const,
        }));
    } catch (error) {
      console.error('Ollama: Failed to fetch models:', error);
      throw error;
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          options: {
            temperature: request.temperature ?? 0.7,
            num_predict: request.max_tokens ?? 2048,
            top_p: request.top_p ?? 0.9,
          },
          stream: true,
        }),
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
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              const content = parsed.message?.content;
              if (content) {
                yield content;
              }
            } catch (e) {
              console.error('Failed to parse Ollama response:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Ollama: Chat error:', error);
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const ollamaService = new OllamaService();
