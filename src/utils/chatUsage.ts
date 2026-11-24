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
}

export function summarizeChatUsage(messages: UIMessage[]): ChatUsage {
  const replies = messages.filter((m) => m.role === 'assistant' && m.usage);
  const replyCosts = new Map<string, number>();
  let cost: number | undefined;
  let unpricedReplies = 0;
  let localReplies = 0;

  for (const reply of replies) {
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

  return {
    contextTokens: contextTokens(replies.at(-1)?.usage),
    totals: addUsage(replies.map((r) => r.usage)),
    cost,
    unpricedReplies,
    allLocal: replies.length > 0 && localReplies === replies.length,
    replyCosts,
  };
}
