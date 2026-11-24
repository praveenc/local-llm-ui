// @vitest-environment node
import { streamText, tool } from 'ai';
import type { ToolSet } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { contextTokens } from '../../src/utils/usage';
import { openAIUsage, replyUsage, usageEvent } from '../usage';

const finish = (input: number, cacheRead: number, output: number, reasoning?: number) => ({
  type: 'finish' as const,
  usage: {
    inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: 0 },
    outputTokens: { total: output, text: output - (reasoning ?? 0), reasoning },
  },
  finishReason: { unified: 'stop' as const, raw: 'stop' },
});

const tools: ToolSet = {
  fetch: tool({
    description: 'Fetch a page',
    inputSchema: z.object({ url: z.string() }),
    execute: async () => 'x'.repeat(100),
  }),
};

/** Step 1 calls a tool; step 2 answers with the tool result in its (larger) input */
function twoStepResult() {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: 'tool-call', toolCallId: 'c1', toolName: 'fetch', input: '{"url":"u"}' },
            { ...finish(1000, 0, 50), finishReason: { unified: 'tool-calls', raw: 'tool_use' } },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Answer' },
          { type: 'text-end', id: 't' },
          finish(1400, 1000, 200, 80),
        ]),
      };
    },
  });
  return streamText({
    model,
    messages: [{ role: 'user', content: 'Q' }],
    tools,
    stopWhen: ({ steps }) => steps.length >= 2,
  });
}

describe('replyUsage', () => {
  it('sums the model calls for cost and keeps each call for the context size', async () => {
    const result = twoStepResult();
    await result.consumeStream();
    const usage = await replyUsage(result);

    expect(usage).toEqual({
      inputTokens: 2400,
      outputTokens: 250,
      totalTokens: 2650,
      cacheReadTokens: 1000,
      reasoningTokens: 80,
      steps: [
        { inputTokens: 1000, outputTokens: 50 },
        { inputTokens: 1400, outputTokens: 200, cacheReadTokens: 1000, reasoningTokens: 80 },
      ],
    });
    // The context holds the last call, not the sum of both calls
    expect(contextTokens(usage)).toBe(1600);
  });

  it('is undefined when the stream failed', async () => {
    const failed = Promise.reject(new Error('boom'));
    failed.catch(() => {});
    expect(await replyUsage({ steps: failed, usage: failed })).toBeUndefined();
    expect(await usageEvent({ steps: failed, usage: failed }, Date.now())).toBeUndefined();
  });

  it('sends totals without steps when there is no step list', async () => {
    const usage = await replyUsage({
      steps: Promise.resolve([]),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 4 }),
    });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  });
});

describe('usageEvent', () => {
  it('is one SSE data line with the usage and the latency', async () => {
    const result = twoStepResult();
    await result.consumeStream();
    const line = await usageEvent(result, Date.now() - 1500);

    expect(line).toMatch(/^data: .*\n\n$/);
    const payload = JSON.parse(line!.slice(6)) as {
      metadata: { usage: { steps: unknown[] }; latencyMs: number };
    };
    expect(payload.metadata.usage.steps).toHaveLength(2);
    expect(payload.metadata.latencyMs).toBeGreaterThanOrEqual(1500);
  });
});

describe('openAIUsage', () => {
  it('reads cached and reasoning tokens from an OpenAI-compatible usage object', () => {
    expect(
      openAIUsage({
        prompt_tokens: 500,
        completion_tokens: 120,
        total_tokens: 620,
        prompt_tokens_details: { cached_tokens: 300 },
        completion_tokens_details: { reasoning_tokens: 40 },
      })
    ).toEqual({
      inputTokens: 500,
      outputTokens: 120,
      totalTokens: 620,
      cacheReadTokens: 300,
      reasoningTokens: 40,
      steps: [{ inputTokens: 500, outputTokens: 120, cacheReadTokens: 300, reasoningTokens: 40 }],
    });
  });

  it('is undefined for a missing usage object', () => {
    expect(openAIUsage(undefined)).toBeUndefined();
  });
});
