import { describe, expect, it } from 'vitest';

import {
  clearLastSelectedModel,
  isProviderConfigured,
  loadLastSelectedModel,
  loadPreferences,
  saveLastSelectedModel,
} from '../preferences';

describe('last selected model', () => {
  it('saves, loads, and clears the model', () => {
    localStorage.clear();
    expect(loadLastSelectedModel()).toBeUndefined();
    saveLastSelectedModel({ id: 'claude-opus-5', provider: 'anthropic' });
    expect(loadLastSelectedModel()).toEqual({ id: 'claude-opus-5', provider: 'anthropic' });
    clearLastSelectedModel();
    expect(loadLastSelectedModel()).toBeUndefined();
  });

  it('ignores a malformed value', () => {
    localStorage.setItem('local-llm-ui-last-model', '{"id":1}');
    expect(loadLastSelectedModel()).toBeUndefined();
    localStorage.setItem('local-llm-ui-last-model', 'not json');
    expect(loadLastSelectedModel()).toBeUndefined();
  });
});

describe('isProviderConfigured', () => {
  const base = loadPreferences();

  it('treats providers that need no API key as configured', () => {
    expect(isProviderConfigured(base, 'bedrock')).toBe(true);
    expect(isProviderConfigured(base, 'lmstudio')).toBe(true);
    expect(isProviderConfigured(base, 'ollama')).toBe(true);
  });

  it('needs a non-blank API key for key-based providers', () => {
    expect(isProviderConfigured(base, 'groq')).toBe(false);
    expect(isProviderConfigured({ ...base, groqApiKey: '   ' }, 'groq')).toBe(false);
    expect(isProviderConfigured({ ...base, groqApiKey: 'gsk_123' }, 'groq')).toBe(true);
    expect(isProviderConfigured({ ...base, bedrockMantleApiKey: 'k' }, 'bedrock-mantle')).toBe(
      true
    );
  });
});
