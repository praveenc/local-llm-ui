import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenRouterService } from '../openrouter';

describe('OpenRouterService.getModels', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['no options', undefined],
    ['no key', {}],
    ['an empty key', { apiKey: ' ' }],
  ])('returns no models with %s, and does not call the route', async (_label, options) => {
    // A key from an older version must not be used
    localStorage.setItem('OPENROUTER_API_KEY', 'or-legacy');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await new OpenRouterService().getModels(options)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the key from the argument, trimmed, and reads no localStorage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ id: 'openai/gpt-5', name: 'GPT-5' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await new OpenRouterService().getModels({ apiKey: ' or-arg ' });

    expect(fetchMock).toHaveBeenCalledWith('/api/openrouter/models', {
      headers: { 'X-Api-Key': 'or-arg' },
    });
    expect(models).toEqual([
      { modelId: 'openai/gpt-5', modelName: 'GPT-5', provider: 'openrouter', vision: false },
    ]);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('reads images only for a model with the image input modality', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              { id: 'a/vision', name: 'V', inputModalities: ['text', 'image', 'file'] },
              { id: 'a/text', name: 'T', inputModalities: ['text'] },
              { id: 'a/none', name: 'N' },
            ],
          }),
      })
    );
    const models = await new OpenRouterService().getModels({ apiKey: 'k' });
    expect(models.map((m) => m.vision)).toEqual([true, false, false]);
  });

  it('keeps the connect error when the route fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(new OpenRouterService().getModels({ apiKey: 'or-arg' })).rejects.toThrow(
      'Cannot connect to OpenRouter. Please check your API key.'
    );
  });
});
