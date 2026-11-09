/**
 * Tool loop settings shared by the AI SDK proxies.
 *
 * With tools, `streamText` calls the model again after each tool result, up to the "Max tool
 * steps" model calls that the user sets in the chat input. The last call must give the answer: it gets an instruction to stop calling tools and,
 * where the provider allows it, the tools are turned off. Without this, a model that calls
 * tools in every step (for example a web search and then several page fetches) stops at the
 * limit with no answer.
 */
import { isStepCount } from 'ai';
import type { FinishReason, PrepareStepFunction, StopCondition, ToolSet } from 'ai';

import { clampToolSteps } from '../src/utils/toolSteps.ts';

export const FINAL_STEP_PROMPT =
  'You cannot call more tools in this reply. Answer my question now. Use the information from the tool results above. If that information is not sufficient, tell me what is missing.';

interface ToolLoopOptions {
  stopWhen: StopCondition<ToolSet>;
  prepareStep: PrepareStepFunction<ToolSet>;
}

interface ToolLoopSettings {
  /** Most model calls in one reply, from the request. Clamped to the allowed range. */
  maxSteps?: unknown;
  /**
   * Set `toolChoice: 'none'` on the last step. Turn this off for Amazon Bedrock: Bedrock has no
   * "none" tool choice, so the AI SDK removes the tools and also removes the tool calls and
   * results from the messages. The model then cannot see what the tools returned.
   */
  disableToolsOnLastStep?: boolean;
}

/** `streamText` options for a tool loop that always ends with an answer */
export function toolLoopOptions(
  tools: ToolSet | undefined,
  { maxSteps, disableToolsOnLastStep = true }: ToolLoopSettings = {}
): Partial<ToolLoopOptions> {
  if (!tools) return {};
  const steps = clampToolSteps(maxSteps);
  return {
    stopWhen: isStepCount(steps),
    prepareStep: ({ stepNumber, messages }) => {
      if (stepNumber < steps - 1) return undefined;
      return {
        messages: [...messages, { role: 'user', content: FINAL_STEP_PROMPT }],
        ...(disableToolsOnLastStep && { toolChoice: 'none' as const }),
      };
    },
  };
}

/** A safe, short message for a stream error part */
export function streamErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500) || 'The model stream failed.';
}

/**
 * Text to show when a reply ends with no answer text, so that the reply does not end with no
 * explanation. Undefined when the reply has text.
 */
export async function noAnswerNotice(result: {
  text: PromiseLike<string>;
  finishReason: PromiseLike<FinishReason>;
  steps: PromiseLike<unknown[]>;
}): Promise<string | undefined> {
  // These reject when the stream failed; the proxy already reported that error
  const [text, finishReason, steps] = await Promise.all([
    result.text,
    result.finishReason,
    result.steps,
  ]).catch(() => [undefined, undefined, undefined] as const);
  if (text === undefined || text.trim()) return undefined;

  let reason: string;
  switch (finishReason) {
    case 'length':
      reason =
        'The reply reached the Max Tokens limit before the model wrote an answer. Increase Max Tokens in the chat input settings and try again.';
      break;
    case 'content-filter':
      reason = 'The content filter of the provider stopped the reply.';
      break;
    case 'tool-calls':
      reason = `The model used all ${steps?.length ?? 'its'} steps for tool calls and did not write an answer. Increase Max Tool Steps in the chat input settings, or ask for fewer pages.`;
      break;
    default:
      reason = 'The model did not write an answer. Try again.';
  }
  return `\n\n_${reason}_`;
}
