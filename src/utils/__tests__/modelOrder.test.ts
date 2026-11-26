import { describe, expect, it } from 'vitest';

import type { Provider } from '../../db/types';
import { currentProvider, currentProviderFirst } from '../modelOrder';

const groups = (...providers: Provider[]) => providers.map((provider) => ({ provider }));
const order = (items: { provider: Provider }[]) => items.map((g) => g.provider);

describe('currentProvider', () => {
  it('uses the provider of the selected model, not the default provider', () => {
    expect(currentProvider({ provider: 'kiro' }, 'ollama')).toBe('kiro');
  });

  it('uses the default provider when no model is selected', () => {
    expect(currentProvider(null, 'ollama')).toBe('ollama');
    expect(currentProvider(undefined, 'groq')).toBe('groq');
  });

  it('is undefined with no model and no default provider', () => {
    expect(currentProvider(null, undefined)).toBeUndefined();
  });
});

describe('currentProviderFirst', () => {
  const all = groups('ollama', 'lmstudio', 'bedrock', 'anthropic', 'kiro');

  it('moves the current provider to the top and keeps the order of the others', () => {
    expect(order(currentProviderFirst(all, 'kiro'))).toEqual([
      'kiro',
      'ollama',
      'lmstudio',
      'bedrock',
      'anthropic',
    ]);
    expect(order(currentProviderFirst(all, 'bedrock'))).toEqual([
      'bedrock',
      'ollama',
      'lmstudio',
      'anthropic',
      'kiro',
    ]);
  });

  it('keeps the order when the current provider is already first', () => {
    expect(order(currentProviderFirst(all, 'ollama'))).toEqual(order(all));
  });

  it('keeps the order when the current provider has no group', () => {
    expect(order(currentProviderFirst(all, 'groq'))).toEqual(order(all));
    expect(order(currentProviderFirst(all, undefined))).toEqual(order(all));
  });

  it('does not change the input', () => {
    const input = groups('ollama', 'kiro');
    const result = currentProviderFirst(input, 'kiro');
    expect(order(input)).toEqual(['ollama', 'kiro']);
    expect(result).not.toBe(input);
  });

  it('handles an empty list', () => {
    expect(currentProviderFirst([], 'kiro')).toEqual([]);
  });
});
