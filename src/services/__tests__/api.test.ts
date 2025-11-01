import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiService } from '../api';

// Mock the service modules
vi.mock('../lmstudio', () => ({
  lmstudioService: {
    getModels: vi.fn(),
    checkConnection: vi.fn(),
  },
}));

vi.mock('../ollama', () => ({
  ollamaService: {
    getModels: vi.fn(),
    checkConnection: vi.fn(),
  },
}));

describe('APIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkConnections', () => {
    it('should check connections for all providers', async () => {
      const { lmstudioService } = await import('../lmstudio');
      const { ollamaService } = await import('../ollama');

      vi.mocked(lmstudioService.checkConnection).mockResolvedValue(true);
      vi.mocked(ollamaService.checkConnection).mockResolvedValue(true);

      const result = await apiService.checkConnections();

      expect(result).toEqual({
        lmstudio: true,
        ollama: true,
        bedrock: false,
      });
    });

    it('should handle connection failures gracefully', async () => {
      const { lmstudioService } = await import('../lmstudio');
      const { ollamaService } = await import('../ollama');

      vi.mocked(lmstudioService.checkConnection).mockResolvedValue(false);
      vi.mocked(ollamaService.checkConnection).mockResolvedValue(false);

      const result = await apiService.checkConnections();

      expect(result).toEqual({
        lmstudio: false,
        ollama: false,
        bedrock: false,
      });
    });
  });

  describe('getAllModels', () => {
    it('should aggregate models from all available providers', async () => {
      const { lmstudioService } = await import('../lmstudio');
      const { ollamaService } = await import('../ollama');

      const lmstudioModels = [
        { modelId: 'model1', modelName: 'Model 1', provider: 'lmstudio' as const },
      ];
      const ollamaModels = [
        { modelId: 'model2', modelName: 'Model 2', provider: 'ollama' as const },
      ];

      vi.mocked(lmstudioService.getModels).mockResolvedValue(lmstudioModels);
      vi.mocked(ollamaService.getModels).mockResolvedValue(ollamaModels);

      const result = await apiService.getAllModels();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(lmstudioModels[0]);
      expect(result).toContainEqual(ollamaModels[0]);
    });

    it('should throw error when no services are available', async () => {
      const { lmstudioService } = await import('../lmstudio');
      const { ollamaService } = await import('../ollama');

      vi.mocked(lmstudioService.getModels).mockRejectedValue(new Error('Not available'));
      vi.mocked(ollamaService.getModels).mockRejectedValue(new Error('Not available'));

      await expect(apiService.getAllModels()).rejects.toThrow(
        'No AI services available. Please start LMStudio or Ollama.'
      );
    });
  });
});
