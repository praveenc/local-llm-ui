export interface Model {
  id: string;
  name: string;
  provider: 'lmstudio' | 'ollama' | 'bedrock';
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
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: 'lmstudio' | 'ollama' | 'bedrock';
}
