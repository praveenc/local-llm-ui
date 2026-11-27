/**
 * Bedrock Mantle Service
 *
 * Client-side service for interacting with Amazon Bedrock Mantle endpoints
 * which provide OpenAI-compatible APIs.
 */
import type { ModelInfo } from './types';

const MANTLE_BASE_URL = '/api/mantle';
const DEFAULT_MANTLE_REGION = 'us-west-2';

/** The key and Region of Bedrock Mantle, from the preferences */
export interface MantleModelOptions {
  apiKey?: string;
  region?: string;
}

export class MantleService {
  /** Lists the models with the key and Region from the preferences; no key, no models */
  async getModels({ apiKey, region }: MantleModelOptions = {}): Promise<ModelInfo[]> {
    const key = apiKey?.trim();
    if (!key) return [];
    const mantleRegion = region?.trim() || DEFAULT_MANTLE_REGION;

    try {
      const response = await fetch(`${MANTLE_BASE_URL}/models`, {
        headers: {
          'X-Mantle-Api-Key': key,
          'X-Mantle-Region': mantleRegion,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.models || [];
    } catch (error) {
      const err = error as Error;
      console.error('Mantle: Failed to fetch models:', error);

      if (err.message?.includes('API key')) {
        throw err;
      }

      throw new Error(
        `Cannot connect to Bedrock Mantle in ${mantleRegion}. Please check your API key.`,
        { cause: error }
      );
    }
  }
}

export const mantleService = new MantleService();
