import { describe, expect, it } from 'vitest';

import type { ProviderModels, UnifiedModel } from '../../hooks/useAllModels';
import { findModel, pickDefaultModel } from '../modelSelection';
import type { Provider } from '../preferences';

const model = (provider: Provider, id: string): UnifiedModel => ({
  id,
  name: id,
  provider,
  providerName: provider,
});

const group = (provider: Provider, ...ids: string[]): ProviderModels => ({
  provider,
  providerName: provider,
  models: ids.map((id) => model(provider, id)),
  status: 'success',
});

const providers = [group('bedrock', 'haiku', 'sonnet'), group('anthropic', 'opus', 'claude-x')];

describe('findModel', () => {
  it('matches on both id and provider', () => {
    expect(findModel(providers, { id: 'opus', provider: 'anthropic' })?.id).toBe('opus');
    expect(findModel(providers, { id: 'opus', provider: 'bedrock' })).toBeNull();
    expect(findModel(providers, undefined)).toBeNull();
  });
});

describe('pickDefaultModel', () => {
  it('uses the last model used with the preferred provider', () => {
    const picked = pickDefaultModel(providers, 'anthropic', {
      preferred: { id: 'claude-x', provider: 'anthropic' },
      any: { id: 'haiku', provider: 'bedrock' },
    });
    expect(picked).toMatchObject({ provider: 'anthropic', id: 'claude-x' });
  });

  it("uses the preferred provider's first model when it has no usable history", () => {
    expect(pickDefaultModel(providers, 'anthropic', {})?.id).toBe('opus');
    expect(
      pickDefaultModel(providers, 'anthropic', {
        preferred: { id: 'removed-model', provider: 'anthropic' },
        any: { id: 'haiku', provider: 'bedrock' },
      })?.id
    ).toBe('opus');
  });

  it('does not pick a model from another provider while the preferred one has models', () => {
    const picked = pickDefaultModel(providers, 'bedrock', {
      any: { id: 'opus', provider: 'anthropic' },
    });
    expect(picked).toMatchObject({ provider: 'bedrock', id: 'haiku' });
  });

  it('falls back to the last used model when the preferred provider has no models', () => {
    const picked = pickDefaultModel(providers, 'groq', {
      any: { id: 'sonnet', provider: 'bedrock' },
    });
    expect(picked).toMatchObject({ provider: 'bedrock', id: 'sonnet' });
    expect(pickDefaultModel(providers, 'groq', {})).toBeNull();
  });
});
