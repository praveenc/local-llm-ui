/**
 * Context use and cost of a chat, read from the usage stored with each reply.
 *
 * Nothing is added up while the chat streams, so the numbers are the same after a reload, after
 * a regenerate, and after a model change.
 */
import type { UIMessage } from '../types/ai-messages';
import { priceFor, replyCost } from './pricing';
import { type UsageTotals, addUsage, contextTokens } from './usage';

export interface ChatUsage {
  /** Tokens in the context window after the last reply that has usage */
  contextTokens: number;
  /** Token totals over all replies */
  totals: UsageTotals;
  /** USD over the replies that have a price; undefined when none has one */
  cost?: number;
  /** Replies with usage but no price */
  unpricedReplies: number;
  /** Every reply with usage ran on a local model */
  allLocal: boolean;
  /** USD of each reply that has a price, by message ID */
  replyCosts: ReadonlyMap<string, number>;
  /** Kiro: the credits of the Kiro replies; 0 when there are none */
  credits: number;
  /** Kiro replies with usage. Kiro bills credits, so they are neither priced nor unpriced. */
  kiroReplies: number;
  /** Kiro: how full the context window is (0 to 100), when the last reply came from Kiro */
  contextPercent?: number;
}

export function summarizeChatUsage(messages: UIMessage[]): ChatUsage {
  const replies = messages.filter((m) => m.role === 'assistant' && m.usage);
  const replyCosts = new Map<string, number>();
  let cost: number | undefined;
  let unpricedReplies = 0;
  let localReplies = 0;
  let credits = 0;
  let kiroReplies = 0;

  for (const reply of replies) {
    if (reply.model?.provider === 'kiro') {
      kiroReplies += 1;
      credits += reply.usage?.credits ?? 0;
      continue;
    }
    const price = reply.model ? priceFor(reply.model.provider, reply.model.id) : undefined;
    const dollars = price ? replyCost(price, reply.usage) : undefined;
    if (price?.kind === 'free') localReplies += 1;
    if (dollars === undefined) {
      unpricedReplies += 1;
      continue;
    }
    replyCosts.set(reply.id, dollars);
    cost = (cost ?? 0) + dollars;
  }

  const last = replies.at(-1);
  return {
    contextTokens: contextTokens(last?.usage),
    totals: addUsage(replies.map((r) => r.usage)),
    cost,
    unpricedReplies,
    allLocal: replies.length > 0 && localReplies === replies.length,
    replyCosts,
    // A sum of floats: 0.21 + 0.42 is 0.6300000000000001
    credits: Number(credits.toFixed(4)),
    kiroReplies,
    ...(last?.model?.provider === 'kiro' &&
      last.usage?.contextPercent !== undefined && { contextPercent: last.usage.contextPercent }),
  };
}
