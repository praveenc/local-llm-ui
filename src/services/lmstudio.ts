import { lmstudioAISDKService } from './aisdk';
import type { ChatRequest, LoadProgressEvent, ModelInfo } from './types';

// Use proxy in development, direct connection in production
const LMSTUDIO_BASE_URL = import.meta.env.DEV ? '/api/lmstudio/v1' : 'http://localhost:1234/v1';
const LMSTUDIO_SDK_URL = '/api/lmstudio-sdk';

export interface LMStudioModelInfo extends ModelInfo {
  modelKey?: string;
  maxContextLength?: number;
  architecture?: string;
  paramsString?: string;
}

export interface LoadModelResult {
  success: boolean;
  identifier?: string;
  modelPath?: string;
  error?: string;
}

export interface LMStudioLoadedModelInfo {
  identifier: string;
  path: string;
  contextLength: number;
  trainedForToolUse: boolean;
  displayName?: string;
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
      console.log('LMStudio: Fetching downloaded models from SDK');
      const sdkResponse = await fetch(`${this.sdkUrl}/models`);

      console.log('LMStudio SDK: Response status:', sdkResponse.status);

      if (sdkResponse.ok) {
        const data = await sdkResponse.json();
        console.log('LMStudio SDK: Raw response:', data);

        if (data.models && data.models.length > 0) {
          const models = data.models.map(
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

          console.log('LMStudio SDK: Parsed models:', models);
          return models;
        } else {
          console.log('LMStudio SDK: No models in response, data:', data);
        }
      } else {
        const errorData = await sdkResponse.json().catch(() => ({}));
        console.error('LMStudio SDK: Error response:', sdkResponse.status, errorData);
        // If SDK returns an error, throw it so we can show proper error message
        if (errorData.error) {
          throw new Error(errorData.error);
        }
      }

      // Fallback to OpenAI-compatible API (only shows loaded models)
      console.log('LMStudio: SDK unavailable or empty, falling back to OpenAI API');
      return this.getLoadedModels();
    } catch (error) {
      console.error('LMStudio: Failed to fetch models:', error);
      // Re-throw connection errors
      const err = error as Error;
      if (err.message?.includes('Cannot connect') || err.message?.includes('Connection')) {
        throw error;
      }
      // Try fallback for other errors
      try {
        return this.getLoadedModels();
      } catch {
        throw error;
      }
    }
  }

  private async getLoadedModels(): Promise<LMStudioModelInfo[]> {
    console.log('LMStudio: Fetching from', `${this.baseUrl}/models`);
    const response = await fetch(`${this.baseUrl}/models`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('LMStudio: Raw response:', data);

    if (!data.data || data.data.length === 0) {
      throw new Error(
        'No models available in LMStudio. Please download models in LM Studio first.'
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
  }

  async loadModel(
    modelPath: string,
    options?: { contextLength?: number; ttl?: number }
  ): Promise<LoadModelResult> {
    try {
      console.log('LMStudio: Loading model:', modelPath);

      const response = await fetch(`${this.sdkUrl}/load`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelPath,
          contextLength: options?.contextLength,
          ttl: options?.ttl ?? 300, // Default 5 minute TTL
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to load model: ${response.status}`);
      }

      const result = await response.json();
      console.log('LMStudio: Model loaded successfully:', result);

      return {
        success: true,
        identifier: result.identifier,
        modelPath: result.modelPath,
      };
    } catch (error) {
      console.error('LMStudio: Failed to load model:', error);
      const err = error as Error;
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async getModelInfo(modelPath?: string): Promise<LMStudioLoadedModelInfo | null> {
    try {
      console.log('LMStudio: Getting model info for:', modelPath || 'current model');

      const response = await fetch(`${this.sdkUrl}/model-info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ modelPath }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to get model info: ${response.status}`);
      }

      const result = await response.json();
      console.log('LMStudio: Model info:', result);

      return {
        identifier: result.identifier,
        path: result.path,
        contextLength: result.contextLength,
        trainedForToolUse: result.trainedForToolUse,
        displayName: result.displayName,
        architecture: result.architecture,
        paramsString: result.paramsString,
      };
    } catch (error) {
      console.error('LMStudio: Failed to get model info:', error);
      return null;
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    // Delegate to AI SDK service for chat streaming with reasoning support
    yield* lmstudioAISDKService.chat(request);
  }

  async *loadModelWithProgress(
    modelPath: string,
    options?: { contextLength?: number; ttl?: number; signal?: AbortSignal }
  ): AsyncGenerator<LoadProgressEvent, void, unknown> {
    try {
      const response = await fetch(`${this.sdkUrl}/load-with-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelPath,
          contextLength: options?.contextLength,
          ttl: options?.ttl ?? 300,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to load model: ${response.status}`);
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
              const event = JSON.parse(data) as LoadProgressEvent;
              yield event;
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('LMStudio: Load model with progress error:', error);
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
