import { bedrockService } from './bedrock';
import { lmstudioService } from './lmstudio';
import { ollamaService } from './ollama';
import type { ChatRequest, ModelInfo } from './types';

export type Provider = 'lmstudio' | 'ollama' | 'bedrock';

class APIService {
  async getAllModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    // Try LMStudio
    try {
      const lmstudioModels = await lmstudioService.getModels();
      models.push(...lmstudioModels);
    } catch {
      console.log('LMStudio not available');
    }

    // Try Ollama
    try {
      const ollamaModels = await ollamaService.getModels();
      models.push(...ollamaModels);
    } catch {
      console.log('Ollama not available');
    }

    // Try Bedrock
    try {
      const bedrockModels = await bedrockService.getModels();
      models.push(...bedrockModels);
    } catch {
      console.log('Bedrock not available');
    }

    if (models.length === 0) {
      throw new Error(
        'No AI services available. Please start LMStudio, Ollama, or configure AWS credentials for Bedrock.'
      );
    }

    return models;
  }

  async *chat(provider: Provider, request: ChatRequest): AsyncGenerator<string, void, unknown> {
    let service;
    if (provider === 'lmstudio') {
      service = lmstudioService;
    } else if (provider === 'ollama') {
      service = ollamaService;
    } else {
      service = bedrockService;
    }
    yield* service.chat(request);
  }

  async checkConnections(): Promise<{ lmstudio: boolean; ollama: boolean; bedrock: boolean }> {
    const [lmstudio, ollama, bedrock] = await Promise.all([
      lmstudioService.checkConnection(),
      ollamaService.checkConnection(),
      bedrockService.checkConnection(),
    ]);

    return { lmstudio, ollama, bedrock };
  }
}

export const apiService = new APIService();
