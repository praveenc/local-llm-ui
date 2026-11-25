import { describe, expect, it } from 'vitest';

import type { UIMessage } from '../../types/ai-messages';
import { summarizeChatUsage } from '../chatUsage';
import { claudeContextWindow, parseClaudeModel } from '../claudeModels';
import { getModelContextLimits } from '../modelContext';
import { priceFor, replyCost } from '../pricing';
import {
  contextLevel,
  contextTokens,
  formatCost,
  formatLatency,
  formatTokens,
  parseMessageUsage,
} from '../usage';

describe('parseMessageUsage', () => {
  it('sums the steps and keeps them', () => {
    const usage = parseMessageUsage({
      steps: [
        { inputTokens: 1000, outputTokens: 50 },
        { inputTokens: 1400, outputTokens: 200, cacheReadTokens: 1000, reasoningTokens: 80 },
      ],
      latencyMs: 2100,
    });
    expect(usage).toMatchObject({
      inputTokens: 2400,
      outputTokens: 250,
      totalTokens: 2650,
      cacheReadTokens: 1000,
      reasoningTokens: 80,
      latencyMs: 2100,
    });
    expect(usage?.steps).toHaveLength(2);
  });

  it('reads the old shape without steps', () => {
    expect(parseMessageUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('drops values that are not counts', () => {
    expect(parseMessageUsage({ inputTokens: -1, outputTokens: 'x' })).toBeUndefined();
    expect(parseMessageUsage(null)).toBeUndefined();
    expect(parseMessageUsage({ inputTokens: 3, outputTokens: 2, extra: 'drop' })).toEqual({
      inputTokens: 3,
      outputTokens: 2,
    });
  });
});

describe('contextTokens', () => {
  it('is the last model call, not the sum over the reply', () => {
    const usage = parseMessageUsage({
      steps: [
        { inputTokens: 1000, outputTokens: 50 },
        { inputTokens: 1400, outputTokens: 200 },
      ],
    });
    expect(contextTokens(usage)).toBe(1600);
  });

  it('uses the totals of a reply stored without steps', () => {
    expect(contextTokens({ inputTokens: 900, outputTokens: 100 })).toBe(1000);
    expect(contextTokens(undefined)).toBe(0);
  });
});

describe('contextLevel', () => {
  it('is near the limit from 70% and almost full from 90%', () => {
    expect(contextLevel(6999, 10000)).toBe('ok');
    expect(contextLevel(7000, 10000)).toBe('near');
    expect(contextLevel(9000, 10000)).toBe('full');
    expect(contextLevel(12000, 10000)).toBe('full');
    expect(contextLevel(10, 0)).toBe('ok');
  });
});

describe('formatting', () => {
  it('formats tokens, latency and cost', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1204)).toBe('1.2K');
    expect(formatLatency(840)).toBe('840 ms');
    expect(formatLatency(2140)).toBe('2.1 s');
    expect(formatLatency(65_000)).toBe('1 min 5 s');
    expect(formatCost(0.0029)).toBe('$0.0029');
    expect(formatCost(0.12345)).toBe('$0.123');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(0.00001)).toBe('<$0.0001');
  });
});

describe('parseClaudeModel', () => {
  it.each([
    ['claude-haiku-5-5', 'haiku-5-5', undefined],
    ['claude-sonnet-4-5-20250929', 'sonnet-4-5', undefined],
    ['claude-sonnet-4-20250514', 'sonnet-4', undefined],
    ['claude-3-5-haiku-20241022', 'haiku-3-5', undefined],
    ['global.anthropic.claude-haiku-5-5', 'haiku-5-5', 'global'],
    ['us.anthropic.claude-opus-4-5-20251101-v1:0', 'opus-4-5', 'regional'],
    ['anthropic.claude-sonnet-5-5', 'sonnet-5-5', 'regional'],
    ['anthropic/claude-sonnet-4.5', 'sonnet-4-5', undefined],
  ])('%s is %s', (id, key, routing) => {
    const model = parseClaudeModel(id);
    expect(model?.key).toBe(key);
    expect(model?.routing).toBe(routing);
  });

  it('is null for other models', () => {
    expect(parseClaudeModel('llama3.2:latest')).toBeNull();
    expect(parseClaudeModel('openai.gpt-oss-120b')).toBeNull();
  });

  it('gives 1M tokens of context from Claude 4.6 and 200K before', () => {
    expect(claudeContextWindow(parseClaudeModel('claude-sonnet-4-6')!)).toBe(1_000_000);
    expect(claudeContextWindow(parseClaudeModel('claude-haiku-5-5')!)).toBe(1_000_000);
    expect(claudeContextWindow(parseClaudeModel('claude-sonnet-4-5-20250929')!)).toBe(200_000);
    expect(
      getModelContextLimits('global.anthropic.claude-haiku-5-5', 'bedrock').contextWindow
    ).toBe(1_000_000);
  });
});

describe('pricing', () => {
  const million = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it('prices Claude from the Anthropic table', () => {
    expect(replyCost(priceFor('anthropic', 'claude-sonnet-5-5'), million)).toBeCloseTo(12);
    expect(replyCost(priceFor('anthropic', 'claude-opus-4-5-20251101'), million)).toBeCloseTo(30);
  });

  it('adds 10% on a Bedrock regional endpoint for Claude 4.5 and later only', () => {
    expect(
      replyCost(priceFor('bedrock', 'global.anthropic.claude-sonnet-5-5'), million)
    ).toBeCloseTo(12);
    expect(replyCost(priceFor('bedrock', 'us.anthropic.claude-sonnet-5-5'), million)).toBeCloseTo(
      13.2
    );
    expect(
      replyCost(priceFor('bedrock', 'us.anthropic.claude-sonnet-4-20250514-v1:0'), million)
    ).toBeCloseTo(18);
  });

  it('bills cache reads and writes at their own rates', () => {
    const price = priceFor('anthropic', 'claude-sonnet-5-5');
    // 1M input, of which 600K read from and 100K written to the cache
    const cost = replyCost(price, {
      steps: [
        {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 600_000,
          cacheWriteTokens: 100_000,
        },
      ],
    });
    expect(cost).toBeCloseTo(0.3 * 2 + 0.1 * 2.5 + 0.6 * 0.1);
  });

  it('uses the long-prompt rates of Claude Haiku 5.5 for each model call over 100K', () => {
    const price = priceFor('anthropic', 'claude-haiku-5-5');
    const cost = replyCost(price, {
      steps: [
        { inputTokens: 100_000, outputTokens: 0 },
        { inputTokens: 200_000, outputTokens: 0 },
      ],
    });
    expect(cost).toBeCloseTo(0.1 * 0.1 + 0.2 * 0.5);
  });

  it('is free for local models and unknown for models without a price', () => {
    expect(priceFor('ollama', 'llama3.2:latest').kind).toBe('free');
    expect(replyCost(priceFor('ollama', 'llama3.2:latest'), million)).toBe(0);
    expect(priceFor('bedrock-mantle', 'nvidia.nemotron-nano-9b-v2').kind).toBe('unknown');
    expect(replyCost(priceFor('openrouter', 'some/new-model'), million)).toBeUndefined();
  });
});

describe('summarizeChatUsage', () => {
  const reply = (id: string, model: UIMessage['model'], usage: UIMessage['usage']): UIMessage => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: 'x' }],
    model,
    usage,
  });
  const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'q' }] };

  it('takes the context from the last reply and the cost from all replies', () => {
    const sonnet = { provider: 'anthropic' as const, id: 'claude-sonnet-5-5' };
    const summary = summarizeChatUsage([
      user,
      reply('a', sonnet, { inputTokens: 1000, outputTokens: 100 }),
      user,
      reply('b', sonnet, {
        inputTokens: 3000,
        outputTokens: 200,
        steps: [
          { inputTokens: 1200, outputTokens: 50 },
          { inputTokens: 1800, outputTokens: 150 },
        ],
      }),
    ]);
    expect(summary.contextTokens).toBe(1950);
    expect(summary.totals).toMatchObject({ inputTokens: 4000, outputTokens: 300, replies: 2 });
    expect(summary.cost).toBeCloseTo((4000 * 2 + 300 * 10) / 1_000_000);
    expect(summary.replyCosts.get('a')).toBeCloseTo((1000 * 2 + 100 * 10) / 1_000_000);
    expect(summary.unpricedReplies).toBe(0);
    expect(summary.allLocal).toBe(false);
  });

  it('counts replies without a price and marks local-only chats', () => {
    const unknown = summarizeChatUsage([
      reply(
        'a',
        { provider: 'bedrock-mantle', id: 'nvidia.nemotron-nano-9b-v2' },
        {
          inputTokens: 10,
          outputTokens: 5,
        }
      ),
    ]);
    expect(unknown.cost).toBeUndefined();
    expect(unknown.unpricedReplies).toBe(1);

    const local = summarizeChatUsage([
      reply('a', { provider: 'ollama', id: 'qwen3:8b' }, { inputTokens: 10, outputTokens: 5 }),
    ]);
    expect(local.allLocal).toBe(true);
    expect(local.cost).toBe(0);
  });

  it('is empty for a chat without usage', () => {
    const summary = summarizeChatUsage([user, reply('a', undefined, undefined)]);
    expect(summary.contextTokens).toBe(0);
    expect(summary.totals.replies).toBe(0);
    expect(summary.credits).toBe(0);
    expect(summary.contextPercent).toBeUndefined();
  });

  it('adds up Kiro credits and takes the context percent of the last Kiro reply', () => {
    const kiro = { provider: 'kiro' as const, id: 'claude-opus-5.5' };
    const summary = summarizeChatUsage([
      user,
      reply('a', kiro, { credits: 0.05, contextPercent: 3, latencyMs: 2900 }),
      user,
      reply('b', kiro, { credits: 0.12, contextPercent: 7.5 }),
    ]);
    expect(summary.credits).toBeCloseTo(0.17);
    expect(summary.kiroReplies).toBe(2);
    expect(summary.contextPercent).toBe(7.5);
    // Kiro replies are neither unpriced nor local, and have no dollar cost
    expect(summary.unpricedReplies).toBe(0);
    expect(summary.allLocal).toBe(false);
    expect(summary.cost).toBeUndefined();
    expect(summary.replyCosts.size).toBe(0);
  });

  it('has no Kiro context percent when the last reply came from another model', () => {
    const summary = summarizeChatUsage([
      reply('a', { provider: 'kiro', id: 'auto' }, { credits: 1, contextPercent: 40 }),
      reply('b', { provider: 'ollama', id: 'qwen3:8b' }, { inputTokens: 10, outputTokens: 5 }),
    ]);
    expect(summary.contextPercent).toBeUndefined();
    expect(summary.credits).toBe(1);
    expect(summary.contextTokens).toBe(15);
  });
});
