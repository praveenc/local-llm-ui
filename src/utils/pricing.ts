/**
 * What a reply costs, from its token usage.
 *
 * Claude prices come from the Anthropic pricing page (see CLAUDE_PRICES). Other cloud models use
 * the tokenlens catalog when it has a price. Local models (Ollama, LM Studio) cost nothing. Any
 * other model has no price, and the UI says so instead of showing $0.00.
 */
import { getUsage } from 'tokenlens';

import type { Provider } from '../db/types';
import { type ClaudeModel, isAtLeast, parseClaudeModel } from './claudeModels';
import { getModelContextLimits } from './modelContext';
import type { MessageUsage, StepUsage } from './usage';

/** USD per million tokens */
export interface Rates {
  input: number;
  output: number;
  /** Writing to the prompt cache (5-minute cache) */
  cacheWrite: number;
  /** Reading from the prompt cache */
  cacheRead: number;
}

export interface PriceList {
  rates: Rates;
  /** Higher rates for a model call whose input is over the threshold (Claude Haiku 5.5) */
  longPrompt?: { overInputTokens: number; rates: Rates };
  /** Applied to every rate, for example 1.1 for a Bedrock regional endpoint */
  multiplier: number;
  source: 'anthropic' | 'tokenlens';
}

export type Price = { kind: 'priced'; list: PriceList } | { kind: 'free' } | { kind: 'unknown' };

/** The date that CLAUDE_PRICES was copied from the pricing page */
export const CLAUDE_PRICES_DATE = '2026-11-24';
export const CLAUDE_PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

const rates = (input: number, output: number, cacheWrite: number, cacheRead: number): Rates => ({
  input,
  output,
  cacheWrite,
  cacheRead,
});

/**
 * Claude API prices in USD per million tokens: input, output, 5-minute cache write, cache read.
 * Copied from CLAUDE_PRICES_SOURCE on CLAUDE_PRICES_DATE. The Claude 3 rows are from the same
 * page before those models left it. See docs/ANTHROPIC_PRICING.md.
 */
const CLAUDE_PRICES: Record<string, Pick<PriceList, 'rates' | 'longPrompt'>> = {
  'fable-5-2': { rates: rates(8, 40, 10, 0.2) },
  'mythos-5-2': { rates: rates(8, 40, 10, 0.2) },
  'fable-5-1': { rates: rates(10, 50, 12.5, 0.25) },
  'mythos-5-1': { rates: rates(10, 50, 12.5, 0.25) },
  'fable-5': { rates: rates(10, 50, 12.5, 1) },
  'mythos-5': { rates: rates(10, 50, 12.5, 1) },
  'opus-5-5': { rates: rates(4, 20, 5, 0.2) },
  'opus-5': { rates: rates(5, 25, 6.25, 0.5) },
  'opus-4-8': { rates: rates(5, 25, 6.25, 0.5) },
  'opus-4-7': { rates: rates(5, 25, 6.25, 0.5) },
  'opus-4-6': { rates: rates(5, 25, 6.25, 0.5) },
  'opus-4-5': { rates: rates(5, 25, 6.25, 0.5) },
  'opus-4-1': { rates: rates(15, 75, 18.75, 1.5) },
  'opus-4': { rates: rates(15, 75, 18.75, 1.5) },
  'sonnet-5-5': { rates: rates(2, 10, 2.5, 0.1) },
  'sonnet-5': { rates: rates(2, 10, 2.5, 0.2) },
  'sonnet-4-6': { rates: rates(3, 15, 3.75, 0.3) },
  'sonnet-4-5': { rates: rates(3, 15, 3.75, 0.3) },
  'sonnet-4': { rates: rates(3, 15, 3.75, 0.3) },
  'haiku-5-5': {
    rates: rates(0.1, 0.5, 0.125, 0.01),
    longPrompt: { overInputTokens: 100_000, rates: rates(0.5, 2.5, 0.625, 0.05) },
  },
  'haiku-4-5': { rates: rates(1, 5, 1.25, 0.1) },
  'sonnet-3-7': { rates: rates(3, 15, 3.75, 0.3) },
  'haiku-3-5': { rates: rates(0.8, 4, 1, 0.08) },
  'opus-3': { rates: rates(15, 75, 18.75, 1.5) },
  'haiku-3': { rates: rates(0.25, 1.25, 0.3, 0.03) },
};

/** Providers that run on this computer */
const LOCAL_PROVIDERS: ReadonlySet<Provider> = new Set(['ollama', 'lmstudio']);

/** Bedrock regional endpoints cost 10% more than global ones for Claude 4.5 and later */
function bedrockMultiplier(model: ClaudeModel): number {
  return model.routing === 'regional' && isAtLeast(model, 4, 5) ? 1.1 : 1;
}

function claudePrice(provider: Provider, modelId: string): Price | null {
  const model = parseClaudeModel(modelId);
  const entry = model && CLAUDE_PRICES[model.key];
  if (!model || !entry) return null;
  const multiplier = provider === 'bedrock' ? bedrockMultiplier(model) : 1;
  return { kind: 'priced', list: { ...entry, multiplier, source: 'anthropic' } };
}

/** Rates from the tokenlens catalog. A catalog entry with no input or output price is no price. */
function tokenlensPrice(tokenlensId: string): Price | null {
  try {
    const perMillion = { input: 1_000_000, output: 1_000_000 };
    const cost = getUsage({ modelId: tokenlensId, usage: perMillion }).costUSD;
    const input = cost?.inputUSD ?? 0;
    const output = cost?.outputUSD ?? 0;
    if (!(input > 0 || output > 0)) return null;
    // tokenlens has no cache prices for most models: cache tokens are billed as input here
    return {
      kind: 'priced',
      list: { rates: rates(input, output, input, input), multiplier: 1, source: 'tokenlens' },
    };
  } catch {
    return null;
  }
}

const cache = new Map<string, Price>();

/** The price of a model, from the Claude table, then the tokenlens catalog */
export function priceFor(provider: Provider, modelId: string): Price {
  const key = `${provider}|${modelId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let price: Price | null = LOCAL_PROVIDERS.has(provider)
    ? { kind: 'free' }
    : claudePrice(provider, modelId);
  if (!price) {
    const tokenlensId = getModelContextLimits(modelId, provider).tokenlensModelId;
    price = (tokenlensId && tokenlensPrice(tokenlensId)) || { kind: 'unknown' };
  }
  cache.set(key, price);
  return price;
}

/** USD for one model call */
export function stepCost(list: PriceList, step: StepUsage): number {
  const r =
    list.longPrompt && step.inputTokens > list.longPrompt.overInputTokens
      ? list.longPrompt.rates
      : list.rates;
  const cacheRead = step.cacheReadTokens ?? 0;
  const cacheWrite = step.cacheWriteTokens ?? 0;
  // Input tokens include the cache tokens; bill them at the cache rates instead
  const uncached = Math.max(0, step.inputTokens - cacheRead - cacheWrite);
  const perMillion =
    uncached * r.input +
    cacheWrite * r.cacheWrite +
    cacheRead * r.cacheRead +
    step.outputTokens * r.output;
  return (perMillion / 1_000_000) * list.multiplier;
}

/**
 * USD for a reply, or undefined when the model has no price. A reply stored without steps is
 * priced as one model call; that can be low for Claude Haiku 5.5 replies that used tools.
 */
export function replyCost(price: Price, usage: MessageUsage | undefined): number | undefined {
  if (!usage || price.kind === 'unknown') return undefined;
  if (price.kind === 'free') return 0;
  const steps: StepUsage[] = usage.steps?.length
    ? usage.steps
    : [
        {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
        },
      ];
  return steps.reduce((total, step) => total + stepCost(price.list, step), 0);
}
