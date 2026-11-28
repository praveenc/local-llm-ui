import type { Provider } from '../db/types';
import type { KiroModel } from '../utils/kiroModels';

export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: Provider;
  profileType?: string; // For Bedrock: SYSTEM_DEFINED, etc.
  modelFamily?: string; // For Bedrock: Anthropic Claude, Meta Llama, etc.
  ownedBy?: string; // For Mantle: model owner
  supportsThinking?: boolean; // For Ollama: the model lists the "thinking" capability
  supportsTools?: boolean; // For Ollama: the model lists the "tools" capability; unset = unknown
  kiro?: KiroModelMeta; // For Kiro: description, credit rate, and effort levels
  vision?: boolean; // Ollama `vision`, LM Studio SDK `vision`, OpenRouter `image` input: reads images
}

/** What Kiro reports about a model, besides its id and name */
export type KiroModelMeta = Omit<KiroModel, 'id' | 'name'>;
