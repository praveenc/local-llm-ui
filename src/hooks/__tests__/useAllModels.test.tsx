import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { loadPreferences } from '../../utils/preferences';
import { useAllModels } from '../useAllModels';
import { KIRO_STATUS_QUERY_KEY } from '../useKiroStatus';

const never = () => new Promise<never>(() => {});
const kiroGetModels = vi.hoisted(() =>
  vi.fn<(refresh?: boolean) => Promise<unknown[]>>(() => Promise.resolve([]))
);
const kiroGetStatus = vi.hoisted(() => vi.fn<(refresh?: boolean) => Promise<unknown>>());
const bedrockGetModels = vi.hoisted(() =>
  vi.fn<() => Promise<unknown[]>>(() => new Promise<never>(() => {}))
);

vi.mock('../../services', () => ({
  kiroService: { getModels: kiroGetModels, getStatus: kiroGetStatus },
  bedrockService: { getModels: bedrockGetModels },
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

  it('shows the Kiro sign-in message without logging it, and asks again after sign-in', async () => {
    localStorage.clear();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    kiroGetModels.mockReset();
    kiroGetModels.mockRejectedValueOnce(new Error('Sign in to Kiro in Preferences → Providers'));
    kiroGetModels.mockResolvedValue([
      { modelId: 'auto', modelName: 'Auto', provider: 'kiro', kiro: { rateMultiplier: 1 } },
    ] as never);
    const prefs = loadPreferences();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(KIRO_STATUS_QUERY_KEY, { state: 'signed-out', path: 'kiro-cli' });
    const { result } = renderHook(() => useAllModels(prefs), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    const kiro = () => result.current.providers.find((p) => p.provider === 'kiro');
    await waitFor(() => expect(kiro()?.status).toBe('error'));
    expect(kiro()?.error).toBe('Sign in to Kiro in Preferences → Providers');
    expect(errorLog).not.toHaveBeenCalledWith(expect.stringContaining('kiro'), expect.anything());

    // Signed in: the Kiro models are fetched again, without the server cache
    act(() => {
      client.setQueryData(KIRO_STATUS_QUERY_KEY, {
        state: 'signed-in',
        path: 'kiro-cli',
        version: '3.5.0',
        account: { type: 'builder-id' },
      });
    });
    await waitFor(() => expect(kiro()?.status).toBe('success'));
    expect(kiro()?.models[0]).toMatchObject({ id: 'auto', kiro: { rateMultiplier: 1 } });
    expect(kiroGetModels).toHaveBeenLastCalledWith(true);
    errorLog.mockRestore();
  });

  it('does not wait for a slow Kiro, but shows its group as loading', async () => {
    localStorage.clear();
    kiroGetModels.mockReset();
    kiroGetModels.mockImplementation(() => never());
    bedrockGetModels.mockResolvedValueOnce([{ modelId: 'haiku', modelName: 'Haiku' }]);
    const prefs = loadPreferences();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAllModels(prefs), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isKiroLoading).toBe(true);
    const byProvider = Object.fromEntries(result.current.providers.map((p) => [p.provider, p]));
    expect(byProvider.bedrock.models.map((m) => m.id)).toEqual(['haiku']);
    expect(byProvider.kiro.status).toBe('loading');
  });

  it('reads the Kiro status without a query function error and without a fetch of its own', async () => {
    localStorage.clear();
    kiroGetModels.mockReset();
    kiroGetModels.mockResolvedValue([]);
    kiroGetStatus.mockReset();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prefs = loadPreferences();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAllModels(prefs), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isKiroLoading).toBe(false));
    act(() => {
      client.setQueryData(KIRO_STATUS_QUERY_KEY, { state: 'signed-out', path: 'kiro-cli' });
    });
    await waitFor(() => expect(kiroGetModels).toHaveBeenCalled());

    const messages = errorLog.mock.calls.map((call) => call.map(String).join(' '));
    expect(messages.filter((message) => message.includes('No queryFn'))).toEqual([]);
    expect(kiroGetStatus).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
