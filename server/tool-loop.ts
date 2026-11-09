/**
 * Tool loop settings shared by the AI SDK proxies.
 *
 * With tools, `streamText` calls the model again after each tool result, up to MAX_STEPS model
 * calls. The last call must give the answer: it gets an instruction to stop calling tools and,
 * where the provider allows it, the tools are turned off. Without this, a model that calls
 * tools in every step (for example a web search and then several page fetches) stops at the
 * limit with no answer.
 */
import { isStepCount } from 'ai';
import type { FinishReason, PrepareStepFunction, StopCondition, ToolSet } from 'ai';

/** Most model calls in one reply, including the last call that must give the answer */
export const MAX_STEPS = 10;

export const FINAL_STEP_PROMPT =
  'You cannot call more tools in this reply. Answer my question now. Use the information from the tool results above. If that information is not sufficient, tell me what is missing.';

interface ToolLoopOptions {
  stopWhen: StopCondition<ToolSet>;
  prepareStep: PrepareStepFunction<ToolSet>;
}

interface ToolLoopSettings {
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
  { disableToolsOnLastStep = true }: ToolLoopSettings = {}
): Partial<ToolLoopOptions> {
  if (!tools) return {};
  return {
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber, messages }) => {
      if (stepNumber < MAX_STEPS - 1) return undefined;
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
      reason = `The model used all ${steps?.length ?? MAX_STEPS} steps for tool calls and did not write an answer. Try again, or ask for fewer pages.`;
      break;
    default:
      reason = 'The model did not write an answer. Try again.';
  }
  return `\n\n_${reason}_`;
}
