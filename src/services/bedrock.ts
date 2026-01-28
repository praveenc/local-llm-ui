import type { ModelInfo } from './types';

const BEDROCK_BASE_URL = '/api/bedrock';

export class BedrockService {
  async getModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${BEDROCK_BASE_URL}/models`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.models || [];
    } catch (error) {
      const err = error as Error;
      console.error('Bedrock: Failed to fetch models:', error);

      // Pass through the error message from the server
      if (err.message?.includes('credentials') || err.message?.includes('AWS')) {
        throw err;
      }

      throw new Error('Cannot connect to Amazon Bedrock. Please check your AWS credentials.');
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${BEDROCK_BASE_URL}/models`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const bedrockService = new BedrockService();
