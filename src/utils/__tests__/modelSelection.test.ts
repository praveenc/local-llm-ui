import { describe, expect, it } from 'vitest';

import type { ProviderModels, UnifiedModel } from '../../hooks/useAllModels';
import { findModel, needsKiroModels, pickDefaultModel, pickLocalModel } from '../modelSelection';
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
  it('prefers the model last picked in the chat input, from any provider', () => {
    const picked = pickDefaultModel(providers, 'bedrock', {
      last: { id: 'claude-x', provider: 'anthropic' },
      preferred: { id: 'sonnet', provider: 'bedrock' },
    });
    expect(picked).toMatchObject({ provider: 'anthropic', id: 'claude-x' });
  });

  it('ignores a last picked model that is no longer available', () => {
    const picked = pickDefaultModel(providers, 'bedrock', {
      last: { id: 'removed-model', provider: 'anthropic' },
      preferred: { id: 'sonnet', provider: 'bedrock' },
    });
    expect(picked).toMatchObject({ provider: 'bedrock', id: 'sonnet' });
  });

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

describe('pickLocalModel', () => {
  it('takes the first Ollama model, then LM Studio', () => {
    expect(pickLocalModel([group('lmstudio', 'qwen'), group('ollama', 'llama3.2')])?.id).toBe(
      'llama3.2'
    );
    expect(pickLocalModel([group('lmstudio', 'qwen')])?.id).toBe('qwen');
  });

  it('never picks a paid provider', () => {
    expect(pickLocalModel(providers)).toBeNull();
    expect(pickLocalModel([group('openrouter', 'x'), group('ollama')])).toBeNull();
  });
});

describe('needsKiroModels', () => {
  const loaded = [group('bedrock', 'haiku')];
  const kiroRef = { id: 'claude-opus-5.5', provider: 'kiro' as const };
  const haikuRef = { id: 'haiku', provider: 'bedrock' as const };

  it('does not wait for Kiro to restore a Bedrock model', () => {
    const pending = { kind: 'default' as const, provider: 'bedrock' as const, last: haikuRef };
    expect(needsKiroModels(loaded, pending, null)).toBe(false);
    // With the Kiro list still loading, the Bedrock model is the one restored
    expect(pickDefaultModel(loaded, 'bedrock', pending)?.id).toBe('haiku');
    expect(
      needsKiroModels(loaded, { kind: 'conversation', conversationId: 'c1', model: haikuRef }, null)
    ).toBe(false);
    expect(needsKiroModels(loaded, null, model('bedrock', 'haiku'))).toBe(false);
  });

  it('waits for Kiro when the model to restore or the selected model is a Kiro model', () => {
    expect(
      needsKiroModels(loaded, { kind: 'default', provider: 'bedrock', last: kiroRef }, null)
    ).toBe(true);
    expect(needsKiroModels(loaded, { kind: 'default', provider: 'kiro' }, null)).toBe(true);
    expect(
      needsKiroModels(loaded, { kind: 'conversation', conversationId: 'c1', model: kiroRef }, null)
    ).toBe(true);
    expect(needsKiroModels(loaded, null, model('kiro', 'auto'))).toBe(true);
  });

  it('counts the last model of any provider only when the preferred provider has none', () => {
    const pending = { kind: 'default' as const, provider: 'bedrock' as const, any: kiroRef };
    expect(needsKiroModels(loaded, pending, null)).toBe(false);
    expect(needsKiroModels([], pending, null)).toBe(true);
  });
});
