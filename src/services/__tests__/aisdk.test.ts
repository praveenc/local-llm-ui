import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelContextLimits } from '../../utils/modelContext';
import { priceFor } from '../../utils/pricing';
import { supportsThinkingEffort } from '../../utils/thinkingEffort';
import { AISDKService } from '../aisdk';

const FALLBACK_IDS = [
  'claude-fable-5-2',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
];

const mockFetch = (response: Partial<Response> & { json?: () => Promise<unknown> }) => {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('AISDKService.getModels', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('anthropic', () => {
    beforeEach(() => localStorage.setItem('ANTHROPIC_API_KEY', 'sk-ant-test'));

    it('returns no models without a key, and does not call the route', async () => {
      localStorage.clear();
      const fetchMock = mockFetch({ ok: true });

      expect(await new AISDKService('anthropic').getModels()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lists the models that the route gives, with their display names', async () => {
      const fetchMock = mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({
            provider: 'anthropic',
            models: [
              { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
              { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
            ],
          }),
      });

      const models = await new AISDKService('anthropic').getModels();

      expect(fetchMock).toHaveBeenCalledWith('/api/aisdk/models?provider=anthropic', {
        method: 'GET',
        headers: { 'X-Api-Key': 'sk-ant-test' },
      });
      expect(models).toEqual([
        expect.objectContaining({
          modelId: 'claude-opus-5-5',
          modelName: 'Claude Opus 5.5',
          provider: 'anthropic',
        }),
        expect.objectContaining({
          modelId: 'claude-opus-4-1-20250805',
          modelName: 'Claude Opus 4.1',
        }),
      ]);
    });

    it('uses the id as the name when the route gives no name', async () => {
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ models: [{ id: 'claude-x' }, { id: 'claude-y', name: ' ' }] }),
      });

      const models = await new AISDKService('anthropic').getModels();

      expect(models.map((m) => m.modelName)).toEqual(['claude-x', 'claude-y']);
    });

    it.each([
      [
        'an error status',
        { ok: false, json: () => Promise.resolve({ error: 'invalid x-api-key' }) },
      ],
      ['a body with no models array', { ok: true, json: () => Promise.resolve({ models: 'x' }) }],
    ])('falls back to the 4 latest models on %s', async (_label, response) => {
      mockFetch(response);

      const models = await new AISDKService('anthropic').getModels();

      expect(models.map((m) => m.modelId)).toEqual(FALLBACK_IDS);
      expect(models.map((m) => m.modelName)).toEqual([
        'Claude Fable 5.2',
        'Claude Opus 5.5',
        'Claude Sonnet 5.5',
        'Claude Haiku 5.5',
      ]);
      expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
    });

    it('falls back when the request itself fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const models = await new AISDKService('anthropic').getModels();

      expect(models.map((m) => m.modelId)).toEqual(FALLBACK_IDS);
    });
  });

  // The route gives the ids that Anthropic lists: dateless from Claude 4.6 on, dated before
  describe('live Anthropic ids with the context, thinking, and price rules', () => {
    it.each([
      ['claude-fable-5-2', 1_000_000],
      ['claude-opus-5-5', 1_000_000],
      ['claude-sonnet-5-5', 1_000_000],
      ['claude-haiku-5-5', 1_000_000],
      ['claude-sonnet-5', 1_000_000],
      ['claude-opus-4-6', 1_000_000],
      ['claude-opus-4-5-20251101', 200_000],
      ['claude-sonnet-4-20250514', 200_000],
      ['claude-opus-4-1-20250805', 200_000],
      ['claude-3-5-haiku-20241022', 200_000],
    ])('%s has a context window of %i', (id, window) => {
      expect(getModelContextLimits(id, 'anthropic').contextWindow).toBe(window);
    });

    it.each([
      'claude-fable-5-2',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-20250514',
    ])('%s takes a thinking effort', (id) => {
      expect(supportsThinkingEffort('anthropic', id)).toBe(true);
    });

    it('does not offer thinking for Claude 3 ids', () => {
      expect(supportsThinkingEffort('anthropic', 'claude-3-5-haiku-20241022')).toBe(false);
    });

    it.each(FALLBACK_IDS)('the fallback model %s has a price', (id) => {
      expect(priceFor('anthropic', id).kind).toBe('priced');
    });
  });

  describe('groq and cerebras (unchanged)', () => {
    it('keeps the id as the name when the route gives no name', async () => {
      localStorage.setItem('GROQ_API_KEY', 'gsk-test');
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ models: [{ id: 'llama-3.3-70b-versatile', ownedBy: 'Meta' }] }),
      });

      const models = await new AISDKService('groq').getModels();

      expect(models).toEqual([
        {
          modelId: 'llama-3.3-70b-versatile',
          modelName: 'llama-3.3-70b-versatile',
          provider: 'groq',
          ownedBy: 'Meta',
        },
      ]);
    });

    it('falls back to the static Groq list on failure', async () => {
      localStorage.setItem('GROQ_API_KEY', 'gsk-test');
      mockFetch({ ok: false, json: () => Promise.resolve({}) });

      const models = await new AISDKService('groq').getModels();

      expect(models[0]).toMatchObject({ modelId: 'llama-3.3-70b-versatile' });
      expect(models).toHaveLength(5);
    });

    it('falls back to the static Cerebras list on failure', async () => {
      localStorage.setItem('CEREBRAS_API_KEY', 'csk-test');
      mockFetch({ ok: false, json: () => Promise.resolve({}) });

      const models = await new AISDKService('cerebras').getModels();

      expect(models.map((m) => m.modelId)).toEqual(['llama-3.3-70b', 'llama3.1-8b']);
    });
  });
});
