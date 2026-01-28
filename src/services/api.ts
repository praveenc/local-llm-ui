import { cerebrasService, groqService } from './aisdk';
import { bedrockService } from './bedrock';
import { lmstudioService } from './lmstudio';
import { mantleService } from './mantle';
import { ollamaService } from './ollama';
import type { ModelInfo } from './types';

export type Provider = 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle' | 'groq' | 'cerebras';

class APIService {
  async getAllModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    // Try LMStudio
    try {
      const lmstudioModels = await lmstudioService.getModels();
      models.push(...lmstudioModels);
    } catch {
      // LMStudio not available
    }

    // Try Ollama
    try {
      const ollamaModels = await ollamaService.getModels();
      models.push(...ollamaModels);
    } catch {
      // Ollama not available
    }

    // Try Bedrock
    try {
      const bedrockModels = await bedrockService.getModels();
      models.push(...bedrockModels);
    } catch {
      // Bedrock not available
    }

    // Try Groq (AI SDK)
    try {
      const groqModels = groqService.getModels();
      models.push(...groqModels);
    } catch {
      // Groq not available
    }

    // Try Cerebras (AI SDK)
    try {
      const cerebrasModels = cerebrasService.getModels();
      models.push(...cerebrasModels);
    } catch {
      // Cerebras not available
    }

    if (models.length === 0) {
      throw new Error(
        'No AI services available. Please start LMStudio, Ollama, or configure AWS credentials for Bedrock.'
      );
    }

    return models;
  }

  async checkConnections(): Promise<{
    lmstudio: boolean;
    ollama: boolean;
    bedrock: boolean;
    'bedrock-mantle': boolean;
    groq: boolean;
    cerebras: boolean;
  }> {
    const [lmstudio, ollama, bedrock, bedrockMantle, groq, cerebras] = await Promise.all([
      lmstudioService.checkConnection(),
      ollamaService.checkConnection(),
      bedrockService.checkConnection(),
      mantleService.checkConnection(),
      groqService.checkConnection(),
      cerebrasService.checkConnection(),
    ]);

    return { lmstudio, ollama, bedrock, 'bedrock-mantle': bedrockMantle, groq, cerebras };
  }

  async checkConnection(provider: Provider): Promise<boolean> {
    switch (provider) {
      case 'lmstudio':
        return lmstudioService.checkConnection();
      case 'ollama':
        return ollamaService.checkConnection();
      case 'bedrock':
        return bedrockService.checkConnection();
      case 'bedrock-mantle':
        return mantleService.checkConnection();
      case 'groq':
        return groqService.checkConnection();
      case 'cerebras':
        return cerebrasService.checkConnection();
      default:
        return false;
    }
  }
}

export const apiService = new APIService();
