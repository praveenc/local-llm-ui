import { describe, expect, it } from 'vitest';

import { modelLabel } from '../modelLabel';

const bedrock = (id: string, name: string) => modelLabel({ provider: 'bedrock', id, name }).label;

describe('modelLabel', () => {
  it('moves the Bedrock profile to the end and drops the vendor', () => {
    expect(bedrock('global.anthropic.claude-haiku-5-5', 'Global Anthropic Claude Haiku 5.5')).toBe(
      'Claude Haiku 5.5 · Global'
    );
    expect(bedrock('us.anthropic.claude-haiku-5-5', 'US Anthropic Claude Haiku 5.5')).toBe(
      'Claude Haiku 5.5 · US'
    );
    expect(bedrock('global.amazon.nova-2-lite-v1:0', 'GLOBAL Amazon Nova 2 Lite')).toBe(
      'Nova 2 Lite · Global'
    );
    expect(bedrock('global.openai.gpt-6-sol', 'Global OpenAI GPT-6 Sol')).toBe(
      'GPT-6 Sol · Global'
    );
    expect(bedrock('global.zai.glm-5.3', 'Global Z.AI GLM 5.3')).toBe('GLM 5.3 · Global');
    expect(bedrock('us.meta.llama3-3-70b-instruct-v1:0', 'US Meta Llama 3.3 70B Instruct')).toBe(
      'Llama 3.3 70B Instruct · US'
    );
  });

  it('keeps names that start with the model, and names without a profile', () => {
    expect(bedrock('us.deepseek.r1-v1:0', 'US DeepSeek-R1')).toBe('DeepSeek-R1 · US');
    expect(bedrock('anthropic.claude-sonnet-5-5', 'Claude Sonnet 5.5')).toBe('Claude Sonnet 5.5');
    expect(bedrock('eu.anthropic.claude-opus-5-5', 'EU Anthropic Claude Opus 5.5')).toBe(
      'Claude Opus 5.5 · EU'
    );
  });

  it('leaves other providers as they are', () => {
    expect(modelLabel({ provider: 'ollama', id: 'qwen3:8b', name: 'qwen3:8b' }).label).toBe(
      'qwen3:8b'
    );
    expect(
      modelLabel({ provider: 'anthropic', id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }).label
    ).toBe('Claude Haiku 5.5');
  });
});
