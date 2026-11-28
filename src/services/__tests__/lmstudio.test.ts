import { afterEach, describe, expect, it, vi } from 'vitest';

describe('lmstudioService URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the app proxy for both lists also when the build is not a dev build', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/lmstudio-sdk/models'
          ? // No SDK list: the service asks the OpenAI-compatible list next
            { ok: true, json: () => Promise.resolve({ models: [] }) }
          : { ok: true, json: () => Promise.resolve({ data: [{ id: 'qwen3-8b' }] }) }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { lmstudioService } = await import('../lmstudio');

    const models = await lmstudioService.getModels();

    expect(models.map((m) => m.modelId)).toEqual(['qwen3-8b']);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/lmstudio-sdk/models',
      '/api/lmstudio/v1/models',
    ]);
  });

  it('reads vision from the SDK list, and gives the fallback list no images', async () => {
    const { LMStudioService } = await import('../lmstudio');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                { modelId: 'a/vl.gguf', modelName: 'VL', vision: true },
                { modelId: 'a/text.gguf', modelName: 'Text', vision: false },
                { modelId: 'a/old.gguf', modelName: 'Old' },
              ],
              url,
            }),
        })
      )
    );
    const sdk = await new LMStudioService('/v1', '/sdk').getModels();
    expect(sdk.map((m) => m.vision)).toEqual([true, false, false]);

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              url === '/sdk/models' ? { models: [] } : { data: [{ id: 'qwen3-8b' }] }
            ),
        })
      )
    );
    const loaded = await new LMStudioService('/v1', '/sdk').getModels();
    expect(loaded.map((m) => m.vision ?? false)).toEqual([false]);
  });
});
