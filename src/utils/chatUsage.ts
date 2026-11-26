/**
 * Context use and cost of a chat, read from the usage stored with each reply.
 *
 * Nothing is added up while the chat streams, so the numbers are the same after a reload, after
 * a regenerate, and after a model change.
 *
 * The totals cover every reply of the chat, from every model. The context fill covers only the
 * current model: it is known when the last reply with usage came from that model. After a model
 * change, the next request sends the whole chat to the new model, with its own tokenizer and
 * window, so a number from an older reply could be wrong. Then the fill stays unknown until the
 * next reply.
 */
import type { UIMessage } from '../types/ai-messages';
import { priceFor, replyCost } from './pricing';
import { type UsageTotals, addUsage, contextTokens } from './usage';

/** The model of the chat input: the model that gets the next message */
export type CurrentModel = Pick<NonNullable<UIMessage['model']>, 'provider' | 'id'>;

export interface ChatUsage {
  /** Tokens in the context window after the last reply, when it came from the current model; else 0 */
  contextTokens: number;
  /** Token totals over all replies, from every model */
  totals: UsageTotals;
  /** USD over the replies that have a price (local replies count as 0); undefined when none has one */
  cost?: number;
  /** Replies with usage that bill tokens (all replies that are not Kiro replies) */
  tokenReplies: number;
  /** Token replies with no price */
  unpricedReplies: number;
  /** The chat has token replies, and each one ran on a local model */
  allLocal: boolean;
  /** USD of each reply that has a price, by message ID */
  replyCosts: ReadonlyMap<string, number>;
  /** Kiro: the credits of the Kiro replies; 0 when there are none */
  credits: number;
  /** Kiro replies with usage. Kiro bills credits, so they are neither priced nor unpriced. */
  kiroReplies: number;
  /** Kiro: how full the context window is (0 to 100), when the last reply came from the current Kiro model */
  contextPercent?: number;
  /** The last reply with usage came from another model (or no model is selected): the fill waits for a reply */
  fillFromOtherModel: boolean;
}

const sameModel = (a: UIMessage['model'], b: CurrentModel | null | undefined) =>
  !!a && !!b && a.provider === b.provider && a.id === b.id;

export function summarizeChatUsage(
  messages: UIMessage[],
  current?: CurrentModel | null
): ChatUsage {
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

  const tokenReplies = replies.length - kiroReplies;
  const last = replies.at(-1);
  const lastIsCurrent = sameModel(last?.model, current);
  const kiroLast = lastIsCurrent && last?.model?.provider === 'kiro';
  return {
    contextTokens: lastIsCurrent && !kiroLast ? contextTokens(last?.usage) : 0,
    totals: addUsage(replies.map((r) => r.usage)),
    cost,
    tokenReplies,
    unpricedReplies,
    allLocal: tokenReplies > 0 && localReplies === tokenReplies,
    replyCosts,
    // A sum of floats: 0.21 + 0.42 is 0.6300000000000001
    credits: Number(credits.toFixed(4)),
    kiroReplies,
    fillFromOtherModel: !!last && !lastIsCurrent,
    ...(kiroLast &&
      last?.usage?.contextPercent !== undefined && { contextPercent: last.usage.contextPercent }),
  };
}
