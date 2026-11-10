import { describe, expect, it } from 'vitest';

import {
  buildReasoningParams,
  fallbackReasoningLevel,
  getClaudeVersion,
  getDefaultThinkingEffort,
  mantleReasoningEffort,
  ollamaThinkValue,
  supportsThinkingEffort,
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

describe('buildReasoningParams', () => {
  const opus = 'global.anthropic.claude-opus-5-5';

  it('maps the effort to the AI SDK reasoning option', () => {
    expect(buildReasoningParams('bedrock', opus, 'off')).toEqual({ reasoning: 'none' });
    expect(buildReasoningParams('bedrock', opus, 'minimal')).toEqual({ reasoning: 'minimal' });
    expect(buildReasoningParams('bedrock', opus, 'xhigh')).toEqual({ reasoning: 'xhigh' });
  });

  it('sends nothing for Default, unknown values, or models without thinking', () => {
    expect(buildReasoningParams('bedrock', opus, 'default')).toEqual({});
    expect(buildReasoningParams('bedrock', opus, undefined)).toEqual({});
    expect(buildReasoningParams('bedrock', opus, 'max')).toEqual({});
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
    expect(mantleReasoningEffort('openai.gpt-oss-120b', 'max')).toBeUndefined();
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
