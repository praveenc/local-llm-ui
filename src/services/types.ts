export interface Model {
  id: string;
  name: string;
  provider: 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle';
}

export interface DocumentBlock {
  name: string;
  format: 'pdf' | 'csv' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'html' | 'txt' | 'md';
  source: {
    bytes: string; // base64 encoded
  };
}

export interface ContentBlock {
  text?: string;
  document?: DocumentBlock;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  files?: Array<{
    name: string;
    format: string;
    bytes: string;
  }>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: 'lmstudio' | 'ollama' | 'bedrock' | 'bedrock-mantle';
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
