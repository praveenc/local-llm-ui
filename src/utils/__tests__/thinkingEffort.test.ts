import { describe, expect, it } from 'vitest';

import type { KiroEffortLevel } from '../kiroModels';
import {
  THINKING_EFFORT_PROVIDERS,
  buildReasoningParams,
  defaultThinkingEffortOptions,
  effortForModel,
  fallbackReasoningLevel,
  getClaudeVersion,
  getDefaultThinkingEffort,
  grokReasoningEffort,
  mantleReasoningEffort,
  nearestThinkingEffort,
  ollamaThinkValue,
  supportsThinkingEffort,
  thinkingEffortOptions,
} from '../thinkingEffort';

describe('getClaudeVersion', () => {
  it.each([
    ['global.anthropic.claude-haiku-5-5', { major: 5, minor: 5 }],
    ['global.anthropic.claude-haiku-4-5-20251001-v1:0', { major: 4, minor: 5 }],
    ['global.anthropic.claude-sonnet-4-20250514-v1:0', { major: 4, minor: 0 }],
    ['global.anthropic.claude-opus-4-6-v1', { major: 4, minor: 6 }],
    ['global.anthropic.claude-opus-5', { major: 5, minor: 0 }],
    ['claude-opus-4-5', { major: 4, minor: 5 }],
  ])('%s', (id, expected) => {
    expect(getClaudeVersion(id)).toEqual(expected);
  });

  it('returns null for old style IDs', () => {
    expect(getClaudeVersion('us.anthropic.claude-3-5-sonnet-20241022-v2:0')).toBeNull();
  });
});

describe('supportsThinkingEffort', () => {
  it('accepts Claude 4+ and OpenAI reasoning models on Bedrock', () => {
    expect(supportsThinkingEffort('bedrock', 'global.anthropic.claude-opus-5-5')).toBe(true);
    expect(supportsThinkingEffort('bedrock', 'us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe(
      true
    );
    expect(supportsThinkingEffort('bedrock', 'us.openai.gpt-5.4')).toBe(true);
    expect(supportsThinkingEffort('bedrock', 'global.openai.gpt-6.1-sol')).toBe(true);
    expect(supportsThinkingEffort('bedrock', 'us.amazon.nova-2-lite-v1:0')).toBe(true);
    expect(supportsThinkingEffort('bedrock', 'global.xai.grok-4.7')).toBe(true);
    expect(supportsThinkingEffort('bedrock', 'us.xai.grok-4.6')).toBe(true);
  });

  it('rejects models without a thinking effort', () => {
    expect(supportsThinkingEffort('bedrock', 'us.anthropic.claude-3-haiku-20240307-v1:0')).toBe(
      false
    );
    expect(supportsThinkingEffort('bedrock', 'us.amazon.nova-pro-v1:0')).toBe(false);
    expect(supportsThinkingEffort('openrouter', 'openai/gpt-4o')).toBe(false);
    expect(supportsThinkingEffort('openrouter', 'openai/gpt-4.1-mini')).toBe(false);
  });

  it('matches OpenAI models on OpenRouter and gpt-oss on Groq', () => {
    expect(supportsThinkingEffort('openrouter', 'openai/o3-mini')).toBe(true);
    expect(supportsThinkingEffort('openrouter', 'anthropic/claude-sonnet-4.5')).toBe(true);
    expect(supportsThinkingEffort('groq', 'openai/gpt-oss-120b')).toBe(true);
    expect(supportsThinkingEffort('groq', 'llama-3.3-70b-versatile')).toBe(false);
  });

  it('uses the capability that Ollama reports for each model', () => {
    expect(supportsThinkingEffort('ollama', 'qwen3:8b', true)).toBe(true);
    expect(supportsThinkingEffort('ollama', 'qwen3:8b', false)).toBe(false);
    expect(supportsThinkingEffort('ollama', 'qwen3:8b')).toBe(false);
  });

  it('matches the Mantle models that take reasoning_effort', () => {
    expect(supportsThinkingEffort('bedrock-mantle', 'openai.gpt-oss-120b')).toBe(true);
    expect(supportsThinkingEffort('bedrock-mantle', 'moonshotai.kimi-k2-thinking')).toBe(true);
    expect(supportsThinkingEffort('bedrock-mantle', 'deepseek.v3.2')).toBe(true);
    expect(supportsThinkingEffort('bedrock-mantle', 'zai.glm-4.7')).toBe(true);
    expect(supportsThinkingEffort('bedrock-mantle', 'qwen.qwen3-32b')).toBe(true);
    // Ignore the setting, or fail with it
    expect(supportsThinkingEffort('bedrock-mantle', 'mistral.magistral-small-2509')).toBe(false);
    expect(supportsThinkingEffort('bedrock-mantle', 'qwen.qwen3-235b-a22b-2507')).toBe(false);
    expect(supportsThinkingEffort('bedrock-mantle', 'qwen.qwen3-coder-next')).toBe(false);
    expect(supportsThinkingEffort('bedrock-mantle', 'minimax.minimax-m2')).toBe(false);
  });

  it('is off for providers whose proxy does not send it', () => {
    expect(supportsThinkingEffort('lmstudio', 'openai/gpt-oss-20b')).toBe(false);
    expect(supportsThinkingEffort('cerebras', 'gpt-oss-120b')).toBe(false);
    // The Anthropic API has no OpenAI models
    expect(supportsThinkingEffort('anthropic', 'gpt-5')).toBe(false);
  });
});

describe('thinkingEffortOptions', () => {
  it('leaves out Off and Minimal for Grok on Bedrock, which always reasons', () => {
    const values = thinkingEffortOptions('bedrock', 'global.xai.grok-4.7').map((o) => o.value);
    expect(values).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
  });

  it('lists every effort for other models', () => {
    const values = thinkingEffortOptions('bedrock', 'global.anthropic.claude-opus-5-5');
    expect(values.map((o) => o.value)).toContain('off');
    expect(values.map((o) => o.value)).toContain('minimal');
    expect(values.map((o) => o.value)).not.toContain('max');
  });

  it("offers a Kiro model's own levels, with Max only when the model has it", () => {
    const opus = thinkingEffortOptions('kiro', 'claude-opus-5.5', {
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    expect(opus).toEqual([
      { value: 'default', label: 'Default' },
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'XHigh' },
      { value: 'max', label: 'Max' },
    ]);
    const sonnet = thinkingEffortOptions('kiro', 'claude-sonnet-5', {
      effortLevels: ['none', 'low', 'medium', 'high'],
    });
    expect(sonnet.map((o) => o.value)).toEqual(['default', 'off', 'low', 'medium', 'high']);
  });

  it('offers nothing for a Kiro model without thinking', () => {
    expect(thinkingEffortOptions('kiro', 'auto', {})).toEqual([]);
    expect(thinkingEffortOptions('kiro', 'auto')).toEqual([]);
  });
});

describe('Kiro thinking effort', () => {
  it('uses what Kiro reports for the model', () => {
    expect(supportsThinkingEffort('kiro', 'claude-opus-5.5', true)).toBe(true);
    expect(supportsThinkingEffort('kiro', 'auto', false)).toBe(false);
    expect(supportsThinkingEffort('kiro', 'claude-opus-5.5')).toBe(false);
  });

  it('has a Default thinking row with Max for Kiro only', () => {
    expect(THINKING_EFFORT_PROVIDERS).toContain('kiro');
    expect(defaultThinkingEffortOptions('kiro').map((o) => o.value)).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(defaultThinkingEffortOptions('bedrock').map((o) => o.value)).not.toContain('max');
  });
});

describe('nearestThinkingEffort', () => {
  const kiroOptions = (levels: ('none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]) =>
    thinkingEffortOptions('kiro', 'm', { effortLevels: levels });

  it('keeps an effort that the model offers', () => {
    expect(nearestThinkingEffort('max', 'kiro', kiroOptions(['low', 'high', 'max']))).toBe('max');
    expect(
      nearestThinkingEffort('high', 'bedrock', thinkingEffortOptions('bedrock', 'claude-opus-5'))
    ).toBe('high');
  });

  it('uses Default for a level that a Kiro model lacks', () => {
    expect(nearestThinkingEffort('max', 'kiro', kiroOptions(['low', 'medium', 'high']))).toBe(
      'default'
    );
    expect(nearestThinkingEffort('minimal', 'kiro', kiroOptions(['low', 'high']))).toBe('default');
  });

  it('turns Max into XHigh on other providers', () => {
    expect(
      nearestThinkingEffort('max', 'bedrock', thinkingEffortOptions('bedrock', 'claude-opus-5'))
    ).toBe('xhigh');
  });

  it('uses the nearest level that the model offers', () => {
    const grok = thinkingEffortOptions('bedrock', 'global.xai.grok-4.7');
    expect(nearestThinkingEffort('off', 'bedrock', grok)).toBe('low');
    expect(nearestThinkingEffort('minimal', 'bedrock', grok)).toBe('low');
  });

  it('keeps the effort for a model without thinking choices', () => {
    expect(nearestThinkingEffort('max', 'kiro', [])).toBe('max');
  });
});

describe('grokReasoningEffort', () => {
  it('maps levels Grok does not have to low and passes the rest through', () => {
    expect(grokReasoningEffort('none')).toBe('low');
    expect(grokReasoningEffort('minimal')).toBe('low');
    expect(grokReasoningEffort('medium')).toBe('medium');
    expect(grokReasoningEffort('xhigh')).toBe('xhigh');
  });
});

describe('buildReasoningParams', () => {
  const opus = 'global.anthropic.claude-opus-5-5';

  it('maps the effort to the AI SDK reasoning option', () => {
    expect(buildReasoningParams('bedrock', opus, 'off')).toEqual({ reasoning: 'none' });
    expect(buildReasoningParams('bedrock', opus, 'minimal')).toEqual({ reasoning: 'minimal' });
    expect(buildReasoningParams('bedrock', opus, 'xhigh')).toEqual({ reasoning: 'xhigh' });
  });

  it('sends XHigh for Max, which only Kiro models offer', () => {
    expect(buildReasoningParams('bedrock', opus, 'max')).toEqual({ reasoning: 'xhigh' });
    expect(mantleReasoningEffort('openai.gpt-oss-120b', 'max')).toBe('high');
    expect(ollamaThinkValue('max', { values: ['low', 'medium', 'high'] })).toBe('high');
  });

  it('sends nothing for Default, unknown values, or models without thinking', () => {
    expect(buildReasoningParams('bedrock', opus, 'default')).toEqual({});
    expect(buildReasoningParams('bedrock', opus, undefined)).toEqual({});
    expect(buildReasoningParams('bedrock', opus, 'turbo')).toEqual({});
    expect(buildReasoningParams('bedrock', opus, 42)).toEqual({});
    expect(buildReasoningParams('lmstudio', 'qwen3:8b', 'high')).toEqual({});
  });
});

describe('getDefaultThinkingEffort', () => {
  it("returns the provider's saved default, else Default", () => {
    const defaults = { bedrock: 'high', anthropic: 'off' } as const;
    expect(getDefaultThinkingEffort(defaults, 'bedrock')).toBe('high');
    expect(getDefaultThinkingEffort(defaults, 'anthropic')).toBe('off');
    expect(getDefaultThinkingEffort(defaults, 'groq')).toBe('default');
    expect(getDefaultThinkingEffort(undefined, 'bedrock')).toBe('default');
    expect(getDefaultThinkingEffort(defaults, undefined)).toBe('default');
  });
});

describe('fallbackReasoningLevel', () => {
  const bedrockError = (values: string) =>
    `Unsupported value: 'minimal' is not supported with the 'us.openai.gpt-5.4' model. Supported values are: ${values}.`;

  it('uses the next lower accepted level, else the next higher one', () => {
    const all = "'none', 'low', 'medium', 'high', 'xhigh', and 'max'";
    expect(fallbackReasoningLevel('minimal', bedrockError(all))).toBe('low');
    expect(fallbackReasoningLevel('xhigh', bedrockError("'low', 'medium', and 'high'"))).toBe(
      'high'
    );
  });

  it('never falls back to none, so Off uses the lowest level', () => {
    const noNone = "'low', 'medium', 'high', 'xhigh', and 'max'";
    expect(fallbackReasoningLevel('none', bedrockError(noNone))).toBe('low');
    expect(fallbackReasoningLevel('minimal', bedrockError("'none', 'high'"))).toBe('high');
  });

  it('returns null when there is nothing to retry', () => {
    expect(fallbackReasoningLevel('low', 'Access denied')).toBeNull();
    // The requested level is accepted, so the request failed for another reason
    expect(fallbackReasoningLevel('low', bedrockError("'low', 'high'"))).toBeNull();
    expect(fallbackReasoningLevel('low', bedrockError("'max'"))).toBeNull();
  });
});

describe('mantleReasoningEffort', () => {
  it('maps efforts to the four values that Mantle accepts', () => {
    const gptOss = 'openai.gpt-oss-120b';
    expect(mantleReasoningEffort(gptOss, 'minimal')).toBe('low');
    expect(mantleReasoningEffort(gptOss, 'medium')).toBe('medium');
    expect(mantleReasoningEffort(gptOss, 'xhigh')).toBe('high');
    // gpt-oss rejects 'none', so Off uses its lowest level
    expect(mantleReasoningEffort(gptOss, 'off')).toBe('low');
  });

  it('sends high for any level on models where only high turns thinking on', () => {
    expect(mantleReasoningEffort('deepseek.v3.2', 'off')).toBe('none');
    expect(mantleReasoningEffort('deepseek.v3.2', 'low')).toBe('high');
    expect(mantleReasoningEffort('zai.glm-4.7', 'medium')).toBe('high');
  });

  it('sends nothing for Default or for other models', () => {
    expect(mantleReasoningEffort('openai.gpt-oss-120b', 'default')).toBeUndefined();
    expect(mantleReasoningEffort('openai.gpt-oss-120b', 'turbo')).toBeUndefined();
    expect(mantleReasoningEffort('mistral.devstral-2-123b', 'high')).toBeUndefined();
  });
});

describe('ollamaThinkValue', () => {
  const gptOss = { values: ['low', 'medium', 'high'] };
  const qwen3 = { values: [false, true] };

  it('sends a level name to models that list levels', () => {
    expect(ollamaThinkValue('medium', gptOss)).toBe('medium');
    expect(ollamaThinkValue('minimal', gptOss)).toBe('low');
    expect(ollamaThinkValue('xhigh', gptOss)).toBe('high');
    // gpt-oss ignores false, so Off uses its lowest level
    expect(ollamaThinkValue('off', gptOss)).toBe('low');
  });

  it('uses the nearest listed level', () => {
    expect(ollamaThinkValue('medium', { values: ['low', 'high'] })).toBe('low');
    expect(ollamaThinkValue('low', { values: ['high'] })).toBe('high');
  });

  it('sends true or false to on/off models', () => {
    expect(ollamaThinkValue('off', qwen3)).toBe(false);
    expect(ollamaThinkValue('low', qwen3)).toBe(true);
    expect(ollamaThinkValue('xhigh', undefined)).toBe(true);
  });

  it('sends nothing for Default', () => {
    expect(ollamaThinkValue('default', gptOss)).toBeUndefined();
    expect(ollamaThinkValue(undefined, qwen3)).toBeUndefined();
  });
});

describe('effortForModel', () => {
  const grok = { provider: 'bedrock' as const, id: 'us.xai.grok-4-6' };
  const claude = { provider: 'bedrock' as const, id: 'global.anthropic.claude-haiku-5-5' };
  const kiroMax = {
    provider: 'kiro' as const,
    id: 'claude-opus-5.5',
    kiro: { effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as KiroEffortLevel[] },
  };
  const kiroNoMax = {
    provider: 'kiro' as const,
    id: 'auto',
    kiro: { effortLevels: ['low', 'medium', 'high'] as KiroEffortLevel[] },
  };

  it('keeps the pick as made: Off on Grok sends Low, and Off again on Claude', () => {
    const pick = 'off' as const;
    expect(effortForModel(pick, grok)).toBe('low');
    expect(effortForModel(pick, claude)).toBe('off');
  });

  it('brings Max back on a Kiro model that has it', () => {
    const pick = 'max' as const;
    expect(effortForModel(pick, kiroNoMax)).toBe('default');
    expect(effortForModel(pick, kiroMax)).toBe('max');
    expect(effortForModel(pick, claude)).toBe('xhigh');
  });
});
