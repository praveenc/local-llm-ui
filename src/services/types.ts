export interface Model {
  id: string;
  name: string;
  provider: 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle' | 'groq' | 'cerebras';
}

export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle' | 'groq' | 'cerebras';
  profileType?: string; // For Bedrock: SYSTEM_DEFINED, etc.
  modelFamily?: string; // For Bedrock: Anthropic Claude, Meta Llama, etc.
  ownedBy?: string; // For Mantle: model owner
}

export type LoadProgressEventType = 'progress' | 'success' | 'error' | 'log';

export interface LoadProgressBaseEvent {
  type: LoadProgressEventType;
}

export interface LoadProgressProgressEvent extends LoadProgressBaseEvent {
  type: 'progress';
  percentage: number;
  message: string;
}

export interface LoadProgressSuccessEvent extends LoadProgressBaseEvent {
  type: 'success';
  identifier: string;
  modelPath: string;
  loadTime: number;
}

export interface LoadProgressErrorEvent extends LoadProgressBaseEvent {
  type: 'error';
  message: string;
}

export interface LoadProgressLogEvent extends LoadProgressBaseEvent {
  type: 'log';
  message: string;
}

export type LoadProgressEvent =
  | LoadProgressProgressEvent
  | LoadProgressSuccessEvent
  | LoadProgressErrorEvent
  | LoadProgressLogEvent;
