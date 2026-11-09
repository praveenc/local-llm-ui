// @vitest-environment node
import { streamText, tool } from 'ai';
import type { ToolSet } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FINAL_STEP_PROMPT, MAX_STEPS, noAnswerNotice, toolLoopOptions } from '../tool-loop';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model step that calls the `fetch` tool */
const toolCallStep = (id: number) => ({
  stream: convertArrayToReadableStream([
    {
      type: 'tool-call' as const,
      toolCallId: `call-${id}`,
      toolName: 'fetch',
      input: JSON.stringify({ url: `https://example.com/${id}` }),
    },
    {
      type: 'finish' as const,
      usage,
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
    },
  ]),
});

/** A model step that writes an answer */
const answerStep = () => ({
  stream: convertArrayToReadableStream([
    { type: 'text-start' as const, id: 't' },
    { type: 'text-delta' as const, id: 't', delta: 'The answer.' },
    { type: 'text-end' as const, id: 't' },
    { type: 'finish' as const, usage, finishReason: { unified: 'stop' as const, raw: 'end_turn' } },
  ]),
});

const tools: ToolSet = {
  fetch: tool({
    description: 'Fetch a page',
    inputSchema: z.object({ url: z.string() }),
    execute: async ({ url }) => `Content of ${url}`,
  }),
};

describe('toolLoopOptions', () => {
  it('sets nothing when there are no tools', () => {
    expect(toolLoopOptions(undefined)).toEqual({});
  });

  it('makes the last step answer when the model keeps calling tools', async () => {
    // The model calls a tool in every step unless the tools are turned off
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls += 1;
        return options.toolChoice?.type === 'none' ? answerStep() : toolCallStep(calls);
      },
    });

    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Read many pages' }],
      tools,
      ...toolLoopOptions(tools),
    });

    expect(await result.text).toBe('The answer.');
    expect(await result.finishReason).toBe('stop');
    expect(model.doStreamCalls).toHaveLength(MAX_STEPS);

    const last = model.doStreamCalls[MAX_STEPS - 1];
    expect(last.toolChoice).toEqual({ type: 'none' });
    // The last step still sees the tool results, and gets the instruction to answer
    expect(JSON.stringify(last.prompt)).toContain('Content of https://example.com/1');
    expect(last.prompt.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: FINAL_STEP_PROMPT }],
    });
    // Earlier steps do not get the instruction
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain(FINAL_STEP_PROMPT);
  });

  it('keeps the tools on the last step when told to (Amazon Bedrock)', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls += 1;
        const lastPrompt = JSON.stringify(options.prompt.at(-1));
        return lastPrompt.includes(FINAL_STEP_PROMPT) ? answerStep() : toolCallStep(calls);
      },
    });

    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'Read many pages' }],
      tools,
      ...toolLoopOptions(tools, { disableToolsOnLastStep: false }),
    });

    expect(await result.text).toBe('The answer.');
    expect(model.doStreamCalls[MAX_STEPS - 1].toolChoice).not.toEqual({ type: 'none' });
  });
});

describe('noAnswerNotice', () => {
  const resultOf = (text: string, finishReason: string, steps = 3) => ({
    text: Promise.resolve(text),
    finishReason: Promise.resolve(finishReason as 'stop'),
    steps: Promise.resolve(Array.from({ length: steps })),
  });

  it('is undefined when the reply has text', async () => {
    expect(await noAnswerNotice(resultOf('Hello', 'stop'))).toBeUndefined();
  });

  it('explains a reply that has no text', async () => {
    expect(await noAnswerNotice(resultOf('', 'length'))).toContain('Max Tokens');
    expect(await noAnswerNotice(resultOf(' ', 'tool-calls', 10))).toContain('all 10 steps');
    expect(await noAnswerNotice(resultOf('', 'stop'))).toContain('did not write an answer');
  });

  it('is undefined when the stream failed', async () => {
    const failed = Promise.reject(new Error('boom'));
    failed.catch(() => {});
    expect(
      await noAnswerNotice({ text: failed, finishReason: failed, steps: failed })
    ).toBeUndefined();
  });
});
