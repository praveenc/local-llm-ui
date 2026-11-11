import type { Provider } from '../db/types';

export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: Provider;
  profileType?: string; // For Bedrock: SYSTEM_DEFINED, etc.
  modelFamily?: string; // For Bedrock: Anthropic Claude, Meta Llama, etc.
  ownedBy?: string; // For Mantle: model owner
  supportsThinking?: boolean; // For Ollama: the model lists the "thinking" capability
}
