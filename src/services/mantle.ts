/**
 * Bedrock Mantle Service
 *
 * Client-side service for interacting with Amazon Bedrock Mantle endpoints
 * which provide OpenAI-compatible APIs.
 */
import type { ModelInfo } from './types';

const MANTLE_BASE_URL = '/api/mantle';

export interface MantleRegion {
  id: string;
  name: string;
  endpoint: string;
}

export class MantleService {
  private apiKey: string | null = null;
  private region: string = 'us-west-2';

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey;
  }

  setRegion(region: string): void {
    this.region = region;
  }

  getApiKey(): string | null {
    return this.apiKey;
  }

  getRegion(): string {
    return this.region;
  }

  hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  async getRegions(): Promise<MantleRegion[]> {
    try {
      const response = await fetch(`${MANTLE_BASE_URL}/regions`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.regions || [];
    } catch (error) {
      console.error('Mantle: Failed to fetch regions:', error);
      throw new Error('Failed to fetch Mantle regions');
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    if (!this.hasApiKey()) {
      throw new Error(
        'Bedrock Mantle API key is required. Please configure it in the preferences.'
      );
    }

    try {
      const response = await fetch(`${MANTLE_BASE_URL}/models`, {
        headers: {
          'X-Mantle-Api-Key': this.apiKey!,
          'X-Mantle-Region': this.region,
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
        `Cannot connect to Bedrock Mantle in ${this.region}. Please check your API key.`
      );
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.hasApiKey()) {
      return false;
    }

    try {
      const response = await fetch(`${MANTLE_BASE_URL}/models`, {
        headers: {
          'X-Mantle-Api-Key': this.apiKey!,
          'X-Mantle-Region': this.region,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const mantleService = new MantleService();
