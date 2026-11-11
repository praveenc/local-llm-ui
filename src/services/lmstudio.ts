import type { ModelInfo } from './types';

// Use proxy in development, direct connection in production
const LMSTUDIO_BASE_URL = import.meta.env.DEV ? '/api/lmstudio/v1' : 'http://localhost:1234/v1';
const LMSTUDIO_SDK_URL = '/api/lmstudio-sdk';

export interface LMStudioModelInfo extends ModelInfo {
  modelKey?: string;
  maxContextLength?: number;
  architecture?: string;
  paramsString?: string;
}

export class LMStudioService {
  private baseUrl: string;
  private sdkUrl: string;

  constructor(baseUrl: string = LMSTUDIO_BASE_URL, sdkUrl: string = LMSTUDIO_SDK_URL) {
    this.baseUrl = baseUrl;
    this.sdkUrl = sdkUrl;
  }

  async getModels(): Promise<LMStudioModelInfo[]> {
    try {
      // Try SDK endpoint first (shows all downloaded models)
      const sdkResponse = await fetch(`${this.sdkUrl}/models`);

      if (sdkResponse.ok) {
        const data = await sdkResponse.json();

        if (data.models && data.models.length > 0) {
          return data.models.map(
            (model: {
              modelId: string;
              modelName: string;
              modelKey?: string;
              maxContextLength?: number;
              architecture?: string;
              paramsString?: string;
            }) => ({
              modelId: model.modelId,
              modelName: model.modelName,
              modelKey: model.modelKey,
              provider: 'lmstudio' as const,
              maxContextLength: model.maxContextLength,
              architecture: model.architecture,
              paramsString: model.paramsString,
            })
          );
        }
      } else {
        const errorData = await sdkResponse.json().catch(() => ({}));
        // If SDK returns an error, throw it so we can show proper error message
        if (errorData.error) {
          throw new Error(errorData.error);
        }
      }

      // Fallback to OpenAI-compatible API (only shows loaded models)
      return this.getLoadedModels();
    } catch (error) {
      // Re-throw expected connection errors without extra console noise
      const err = error as Error;
      if (
        err.message?.includes('Cannot connect') ||
        err.message?.includes('Connection') ||
        err.message?.includes('LM Studio is not connected')
      ) {
        throw error;
      }

      console.error('LMStudio: Failed to fetch models:', error);
      // Try fallback for other errors
      try {
        return await this.getLoadedModels();
      } catch {
        throw error;
      }
    }
  }

  private async getLoadedModels(): Promise<LMStudioModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      throw new Error(
        'No models available in LMStudio. Please download models in LM Studio first.'
      );
    }

    return data.data
      .filter((model: { id: string }) => !model.id.toLowerCase().includes('embed'))
      .map((model: { id: string }) => ({
        modelId: model.id,
        modelName: model.id,
        provider: 'lmstudio' as const,
      }));
  }
}

export const lmstudioService = new LMStudioService();
