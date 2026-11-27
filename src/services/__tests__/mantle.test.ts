import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MantleService } from '../mantle';

describe('MantleService.getModels', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['no options', undefined],
    ['no key', { region: 'eu-west-1' }],
    ['an empty key', { apiKey: '', region: 'eu-west-1' }],
  ])('returns no models with %s, and does not call the route', async (_label, options) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await new MantleService().getModels(options)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the key and the region from the argument', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ modelId: 'openai.gpt-oss-120b' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await new MantleService().getModels({
      apiKey: 'mantle-arg',
      region: 'eu-west-1',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/mantle/models', {
      headers: { 'X-Mantle-Api-Key': 'mantle-arg', 'X-Mantle-Region': 'eu-west-1' },
    });
    expect(models).toEqual([{ modelId: 'openai.gpt-oss-120b' }]);
  });

  it('uses us-west-2 when no region is given, and names it in the connect error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new MantleService().getModels({ apiKey: 'mantle-arg' })).rejects.toThrow(
      'Cannot connect to Bedrock Mantle in us-west-2. Please check your API key.'
    );
    expect(fetchMock.mock.calls[0][1]).toEqual({
      headers: { 'X-Mantle-Api-Key': 'mantle-arg', 'X-Mantle-Region': 'us-west-2' },
    });
  });
});
