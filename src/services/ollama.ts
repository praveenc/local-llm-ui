import type { ModelInfo } from './types';

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
