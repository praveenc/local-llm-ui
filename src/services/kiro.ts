import type { KiroStatus } from '../utils/kiroStatus';
import type { ModelInfo } from './types';

export class KiroService {
  /** The state of kiro-cli on the computer that runs the app; `refresh` skips the server cache */
  async getStatus(refresh = false): Promise<KiroStatus> {
    const response = await fetch(`/api/kiro/status${refresh ? '?refresh=1' : ''}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as KiroStatus;
  }

  // Kiro lists no models until the chat works
  async getModels(): Promise<ModelInfo[]> {
    return [];
  }
}

export const kiroService = new KiroService();
