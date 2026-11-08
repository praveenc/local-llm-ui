import { describe, expect, it } from 'vitest';

import { isProviderConfigured, loadPreferences } from '../preferences';

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
