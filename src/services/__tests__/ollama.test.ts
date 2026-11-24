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

  it('leaves tool support unknown when Ollama lists no capabilities', async () => {
    mockTags([{ name: 'llama3.2' }]);
    const [model] = await new OllamaService('/ollama').getModels();

    expect(model.supportsTools).toBeUndefined();
  });
});
