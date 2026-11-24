/**
 * The usage event that the AI SDK proxies send at the end of a reply.
 *
 * `result.usage` from `streamText` is the sum over all model calls in the reply. With tools,
 * each call sends the whole conversation again, so that sum is what the provider bills but not
 * how full the context window is. The event therefore carries each call ("step") as well; the
 * browser uses the last step for the context meter and the sum for cost.
 */
import type { LanguageModelUsage } from 'ai';

import {
  type MessageUsage,
  type StepUsage,
  parseMessageUsage,
  sumSteps,
} from '../src/utils/usage.ts';

type UsageLike = Partial<LanguageModelUsage> | undefined;

interface StreamResultLike {
  steps: PromiseLike<ReadonlyArray<{ usage: UsageLike }>>;
  usage: PromiseLike<UsageLike>;
}

/** One model call. AI SDK input tokens already include the tokens read from or written to the cache. */
export function toStepUsage(usage: UsageLike): StepUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens || undefined,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens || undefined,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens || undefined,
  };
}

/**
 * The usage of a finished reply, or undefined when the stream failed. The promises reject when
 * the stream failed; the proxy has already sent that error, so it is not reported again.
 */
export async function replyUsage(result: StreamResultLike): Promise<MessageUsage | undefined> {
  const steps = await Promise.resolve(result.steps).catch(() => undefined);
  if (steps && steps.length > 0) return sumSteps(steps.map((step) => toStepUsage(step.usage)));

  // No step list: send the totals without steps, so the browser does not take them for one call
  const usage = await Promise.resolve(result.usage).catch(() => undefined);
  if (!usage) return undefined;
  const totals = sumSteps([toStepUsage(usage)]);
  delete totals.steps;
  return totals;
}

/** The SSE line with the usage and latency of a reply, or undefined when there is no usage */
export async function usageEvent(
  result: StreamResultLike,
  startTime: number
): Promise<string | undefined> {
  const usage = await replyUsage(result);
  if (!usage) return undefined;
  return `data: ${JSON.stringify({ metadata: { usage, latencyMs: Date.now() - startTime } })}\n\n`;
}

/** Usage from an OpenAI-compatible `usage` object (Bedrock Mantle): one model call */
export function openAIUsage(value: unknown): MessageUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const u = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
  return parseMessageUsage({
    steps: [
      {
        inputTokens: u.prompt_tokens,
        outputTokens: u.completion_tokens,
        cacheReadTokens: u.prompt_tokens_details?.cached_tokens,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens,
      },
    ],
  });
}
