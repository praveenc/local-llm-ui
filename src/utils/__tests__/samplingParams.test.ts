import { describe, expect, it } from 'vitest';

import { buildSamplingParams, getClaudeVersion, getSamplingSupport } from '../samplingParams';

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

describe('getSamplingSupport', () => {
  it.each([
    ['us.anthropic.claude-3-haiku-20240307-v1:0', 'both'],
    ['global.anthropic.claude-sonnet-4-20250514-v1:0', 'one'],
    ['global.anthropic.claude-haiku-4-5-20251001-v1:0', 'one'],
    ['global.anthropic.claude-opus-4-6-v1', 'one'],
    ['global.anthropic.claude-opus-4-7', 'none'],
    ['global.anthropic.claude-sonnet-5', 'none'],
    ['global.anthropic.claude-haiku-5-5', 'none'],
    ['us.anthropic.claude-fable-5-1', 'none'],
    ['global.anthropic.claude-mythos-5', 'none'],
    ['global.anthropic.claude-opus-4-8', 'none'],
    ['global.anthropic.claude-opus-5-5', 'none'],
    ['claude-sonnet-5-5', 'none'],
    ['us.meta.llama3-3-70b-instruct-v1:0', 'both'],
    ['openai.gpt-oss-120b-1:0', 'both'],
  ])('%s -> %s', (id, expected) => {
    expect(getSamplingSupport(id)).toBe(expected);
  });
});

describe('buildSamplingParams', () => {
  const input = { temperature: 0.5, topP: 0.9 };

  it('sends nothing to models that reject both', () => {
    expect(buildSamplingParams('global.anthropic.claude-haiku-5-5', input)).toEqual({});
  });

  it('sends only the preferred parameter to Claude 4.0 - 4.6', () => {
    const id = 'global.anthropic.claude-sonnet-4-6';
    expect(buildSamplingParams(id, input)).toEqual({ temperature: 0.5 });
    expect(buildSamplingParams(id, { ...input, preferred: 'topP' })).toEqual({ topP: 0.9 });
    expect(buildSamplingParams(id, { topP: 0.9 })).toEqual({ topP: 0.9 });
  });

  it('sends both to other models and drops undefined values', () => {
    expect(buildSamplingParams('us.meta.llama3-3-70b-instruct-v1:0', input)).toEqual(input);
    expect(buildSamplingParams('us.meta.llama3-3-70b-instruct-v1:0', { topP: 0.9 })).toEqual({
      topP: 0.9,
    });
  });
});
