import type { ModelInfo } from './types';

// Always the app's own proxy: the proxies exist only in the Vite dev server (npm run dev)
const OLLAMA_BASE_URL = '/api/ollama';

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
        .map((model: { name: string; capabilities?: string[] }) => ({
          modelId: model.name,
          modelName: model.name,
          provider: 'ollama' as const,
          // Ollama 0.6+ lists capabilities in /api/tags
          supportsThinking: model.capabilities?.includes('thinking') ?? false,
          // Unknown when Ollama does not list capabilities: then the app sends tools as before
          supportsTools: model.capabilities ? model.capabilities.includes('tools') : undefined,
        }));
    } catch (error) {
      console.error('Ollama: Failed to fetch models:', error);
      throw error;
    }
  }
}

export const ollamaService = new OllamaService();
