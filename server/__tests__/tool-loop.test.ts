// @vitest-environment node
import { streamText, tool } from 'ai';
import type { ToolSet } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DEFAULT_TOOL_STEPS, MAX_TOOL_STEPS } from '../../src/utils/toolSteps';
import { FINAL_STEP_PROMPT, noAnswerNotice, toolLoopOptions } from '../tool-loop';

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

  /** Run a loop where the model calls a tool in every step unless the tools are turned off */
  const runLoop = async (maxSteps?: unknown) => {
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
      ...toolLoopOptions(tools, { maxSteps }),
    });
    return { model, text: await result.text, finishReason: await result.finishReason };
  };

  it('uses the step count from the request', async () => {
    const { model, text } = await runLoop(4);
    expect(text).toBe('The answer.');
    expect(model.doStreamCalls).toHaveLength(4);
    expect(model.doStreamCalls[3].toolChoice).toEqual({ type: 'none' });
  });

  it('limits the step count from the request to the allowed range', async () => {
    expect((await runLoop(500)).model.doStreamCalls).toHaveLength(MAX_TOOL_STEPS);
    expect((await runLoop('ten')).model.doStreamCalls).toHaveLength(DEFAULT_TOOL_STEPS);
  });

  it('makes the last step answer when the model keeps calling tools', async () => {
    const { model, text, finishReason } = await runLoop();

    expect(text).toBe('The answer.');
    expect(finishReason).toBe('stop');
    expect(model.doStreamCalls).toHaveLength(DEFAULT_TOOL_STEPS);

    const last = model.doStreamCalls[DEFAULT_TOOL_STEPS - 1];
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
    expect(model.doStreamCalls[DEFAULT_TOOL_STEPS - 1].toolChoice).not.toEqual({ type: 'none' });
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
