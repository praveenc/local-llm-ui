import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { loadPreferences } from '../../utils/preferences';
import { useAllModels } from '../useAllModels';

const never = () => new Promise<never>(() => {});

vi.mock('../../services', () => ({
  kiroService: { getModels: () => Promise.resolve([]) },
  bedrockService: { getModels: () => never() },
  lmstudioService: { getModels: () => Promise.reject(new Error('LM Studio is not connected')) },
  ollamaService: {
    getModels: () =>
      Promise.resolve([
        { modelId: 'llama3.2', modelName: 'llama3.2' },
        { modelId: 'gemma3', modelName: 'gemma3', supportsTools: false },
      ]),
  },
  mantleService: { getModels: () => never(), setApiKey: vi.fn(), setRegion: vi.fn() },
}));
vi.mock('../../services/aisdk', () => ({
  anthropicService: { getModels: () => never() },
  cerebrasService: { getModels: () => never() },
  groqService: { getModels: () => never() },
  syncApiKeysFromPreferences: vi.fn(),
}));
vi.mock('../../services/openrouter', () => ({
  openrouterService: { getModels: () => never(), setApiKey: vi.fn() },
}));

describe('useAllModels', () => {
  it('shows each provider as soon as its own probe returns', async () => {
    localStorage.clear();
    const prefs = loadPreferences();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAllModels(prefs), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() =>
      expect(result.current.providers.find((p) => p.provider === 'ollama')?.status).toBe('success')
    );
    const byProvider = Object.fromEntries(result.current.providers.map((p) => [p.provider, p]));
    expect(byProvider.ollama.models.map((m) => m.id)).toEqual(['llama3.2', 'gemma3']);
    // Tool support is copied only when the provider reports it
    expect(byProvider.ollama.models[0]).not.toHaveProperty('supportsTools');
    expect(byProvider.ollama.models[1].supportsTools).toBe(false);
    expect(byProvider.lmstudio.status).toBe('error');
    // Bedrock has not answered yet
    expect(byProvider.bedrock.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);
  });
});
