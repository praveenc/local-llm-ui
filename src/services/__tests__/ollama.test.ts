import { afterEach, describe, expect, it, vi } from 'vitest';

import { OllamaService } from '../ollama';

const mockTags = (models: Array<{ name: string; capabilities?: string[] }>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ models }) })
  );
};

describe('OllamaService.getModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads tool and thinking support from the capabilities', async () => {
    mockTags([
      { name: 'qwen3:8b', capabilities: ['completion', 'tools', 'thinking'] },
      { name: 'gemma3:4b', capabilities: ['completion', 'vision'] },
    ]);
    const models = await new OllamaService('/ollama').getModels();

    expect(models).toEqual([
      expect.objectContaining({ modelId: 'qwen3:8b', supportsTools: true, supportsThinking: true }),
      expect.objectContaining({
        modelId: 'gemma3:4b',
        supportsTools: false,
        supportsThinking: false,
      }),
    ]);
  });

  it('reads images only for a model that lists vision', async () => {
    mockTags([
      { name: 'gemma3:4b', capabilities: ['completion', 'vision'] },
      { name: 'qwen3:8b', capabilities: ['completion', 'tools'] },
      { name: 'llama3.2' },
    ]);
    const models = await new OllamaService('/ollama').getModels();
    expect(models.map((m) => m.vision)).toEqual([true, false, false]);
  });

  it('leaves tool support unknown when Ollama lists no capabilities', async () => {
    mockTags([{ name: 'llama3.2' }]);
    const [model] = await new OllamaService('/ollama').getModels();

    expect(model.supportsTools).toBeUndefined();
  });
});

describe('ollamaService URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the app proxy also when the build is not a dev build', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    mockTags([{ name: 'qwen3:8b' }]);
    const { ollamaService } = await import('../ollama');

    await ollamaService.getModels();

    expect(fetch).toHaveBeenCalledWith('/api/ollama/api/tags');
  });
});
