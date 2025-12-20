import type { ChatRequest, ModelInfo } from './types';

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
        }
      }

      // Fallback to OpenAI-compatible API (only shows loaded models)
      console.log('LMStudio: SDK unavailable, falling back to OpenAI API');
      return this.getLoadedModels();
    } catch (error) {
      console.error('LMStudio: Failed to fetch models:', error);
      // Try fallback
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
