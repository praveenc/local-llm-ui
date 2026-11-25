/**
 * Token usage of a reply, shared by the browser and the server proxies.
 *
 * A reply can take several model calls ("steps") when tools are on: each step sends the whole
 * conversation again, plus the tool results so far. So the sum over the steps is what the
 * provider bills, and the last step alone shows how full the context window got.
 *
 * Keep this file free of DOM and Node imports.
 */

/** Token usage of one model call */
export interface StepUsage {
  /** All input tokens, including tokens read from or written to the prompt cache */
  inputTokens: number;
  /** All output tokens, including reasoning tokens */
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** Token usage of one reply. The token totals are the sum over all model calls in the reply. */
export interface MessageUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Each model call in the reply, in order. Replies stored before this field have none. */
  steps?: StepUsage[];
  latencyMs?: number;
  /** Kiro: the credits of this reply. Kiro reports credits, not tokens. */
  credits?: number;
  /** Kiro: how full the context window is after this reply, 0 to 100 */
  contextPercent?: number;
}

/** Token totals over the replies of a chat */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** Replies that have usage */
  replies: number;
}

const MAX_STEPS = 100;

/** A count that is a finite number of zero or more, else undefined */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/** A finite amount of zero or more, not rounded (credits), else undefined */
function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A percentage from 0 to 100, else undefined */
function percent(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

/** Drops fields that are undefined, so stored records stay small */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function parseStep(value: unknown): StepUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  return compact({
    inputTokens: count(v.inputTokens) ?? 0,
    outputTokens: count(v.outputTokens) ?? 0,
    cacheReadTokens: count(v.cacheReadTokens) || undefined,
    cacheWriteTokens: count(v.cacheWriteTokens) || undefined,
    reasoningTokens: count(v.reasoningTokens) || undefined,
  });
}

/** Reads usage sent by a server proxy. Unknown fields and values that are not counts are dropped. */
export function parseMessageUsage(value: unknown): MessageUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const steps = Array.isArray(v.steps)
    ? v.steps
        .slice(0, MAX_STEPS)
        .map(parseStep)
        .filter((s): s is StepUsage => s !== undefined)
    : undefined;
  const kiro = compact({ credits: amount(v.credits), contextPercent: percent(v.contextPercent) });
  if (steps && steps.length > 0) {
    return { ...sumSteps(steps), ...compact({ latencyMs: count(v.latencyMs) }), ...kiro };
  }
  const usage = compact({
    inputTokens: count(v.inputTokens),
    outputTokens: count(v.outputTokens),
    totalTokens: count(v.totalTokens),
    cacheReadTokens: count(v.cacheReadTokens) || undefined,
    cacheWriteTokens: count(v.cacheWriteTokens) || undefined,
    reasoningTokens: count(v.reasoningTokens) || undefined,
    latencyMs: count(v.latencyMs),
    ...kiro,
  });
  return usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.credits === undefined &&
    usage.contextPercent === undefined
    ? undefined
    : usage;
}

/** The usage of a reply from the usage of its model calls */
export function sumSteps(steps: StepUsage[]): MessageUsage {
  const sum = (key: keyof StepUsage) => steps.reduce((total, s) => total + (s[key] ?? 0), 0);
  const inputTokens = sum('inputTokens');
  const outputTokens = sum('outputTokens');
  return compact({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: sum('cacheReadTokens') || undefined,
    cacheWriteTokens: sum('cacheWriteTokens') || undefined,
    reasoningTokens: sum('reasoningTokens') || undefined,
    steps,
  });
}

/**
 * Tokens in the context window after this reply: the input and output of its last model call.
 * A reply stored without steps had one call, or its true size is unknown; its totals are used.
 */
export function contextTokens(usage: MessageUsage | undefined): number {
  if (!usage) return 0;
  const last = usage.steps?.at(-1);
  if (last) return last.inputTokens + last.outputTokens;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** Adds the usage of replies together */
export function addUsage(usages: Array<MessageUsage | undefined>): UsageTotals {
  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    replies: 0,
  };
  for (const usage of usages) {
    if (!usage) continue;
    totals.inputTokens += usage.inputTokens ?? 0;
    totals.outputTokens += usage.outputTokens ?? 0;
    totals.cacheReadTokens += usage.cacheReadTokens ?? 0;
    totals.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    totals.reasoningTokens += usage.reasoningTokens ?? 0;
    totals.replies += 1;
  }
  return totals;
}

/** How full the context window is: from 70% it is near the limit, from 90% almost full */
export type ContextLevel = 'ok' | 'near' | 'full';

export const CONTEXT_NEAR = 0.7;
export const CONTEXT_FULL = 0.9;

export function contextLevel(usedTokens: number, maxTokens: number): ContextLevel {
  const fraction = maxTokens > 0 ? usedTokens / maxTokens : 0;
  if (fraction >= CONTEXT_FULL) return 'full';
  if (fraction >= CONTEXT_NEAR) return 'near';
  return 'ok';
}

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 950, 1.2K, 3.4M */
export function formatTokens(tokens: number): string {
  return compactNumber.format(tokens);
}

/** 840 ms, 2.1 s, 1 min 5 s */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** $0.0029, $0.123, $1.23. Amounts of a cent or less keep enough digits to be seen. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0.00';
  if (dollars < 0.0001) return '<$0.0001';
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return usd.format(dollars);
}
