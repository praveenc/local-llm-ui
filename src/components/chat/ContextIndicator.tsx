/**
 * ContextIndicator
 *
 * The context ring in the chat input. The ring shows how full the context window was after the
 * last reply, when that reply came from the current model. The popover shows the totals of the
 * whole chat, from every model: the tokens and the cost, and the Kiro credits on their own line.
 *
 * Kiro reports a percentage and credits, not tokens: for a Kiro model the ring shows Kiro's
 * percentage after its last reply, and the popover also has the plan and credits of the account.
 *
 * When the current model has not replied last (a model change, or no model), the fill is not
 * known. The chip then shows a chart icon and no percentage, and the popover says so.
 */
import { ChartNoAxesColumnIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChatUsage } from '@/utils/chatUsage';
import { formatCredits } from '@/utils/kiroModels';
import { formatCost, formatTokens } from '@/utils/usage';

import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from '../ai-elements/context';
import { KiroUsageLine } from './KiroUsageLine';
import { composerChip } from './composerStyles';

interface ContextIndicatorProps {
  usage: ChatUsage;
  /** Context window of the current model; undefined for a Kiro model or with no model */
  maxTokens?: number;
  /** The current model is a Kiro model */
  kiro?: boolean;
  /** No model is selected */
  noModel?: boolean;
}

const chipClass = `${composerChip} gap-1 px-2 tabular-nums has-[>svg]:px-2`;

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {value}
        {detail && <span className="ml-1.5 text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
}

/** The cost line: a price, "Free", or "No price data" */
function costText(usage: ChatUsage): { value: string; note?: string } {
  if (usage.allLocal) return { value: 'Free', note: 'Local model' };
  if (usage.cost === undefined) return { value: 'No price data' };
  const unpriced = usage.unpricedReplies;
  // Only free replies have a price: "$0.00" would read as the price of the whole chat
  if (usage.cost === 0 && unpriced > 0) return { value: 'No price data' };
  return {
    value: formatCost(usage.cost),
    note: unpriced
      ? `${unpriced} ${unpriced === 1 ? 'reply has' : 'replies have'} no price data`
      : undefined,
  };
}

/** The fill of the ring, when the last reply came from the current model */
function contextFill(
  usage: ChatUsage,
  maxTokens: number | undefined,
  kiro: boolean
): { used: number; max: number } | undefined {
  if (kiro) {
    return usage.contextPercent === undefined
      ? undefined
      : { used: usage.contextPercent, max: 100 };
  }
  if (!maxTokens || usage.contextTokens === 0) return undefined;
  return { used: usage.contextTokens, max: maxTokens };
}

/** The text in place of the fill, when the fill is not known */
function fillNote(usage: ChatUsage, noModel: boolean): string | undefined {
  if (noModel) return 'Select a model to see the context use.';
  if (usage.fillFromOtherModel) return 'Context use shows after the next reply from this model.';
  return undefined;
}

export function ContextIndicator({
  usage,
  maxTokens,
  kiro = false,
  noModel = false,
}: ContextIndicatorProps) {
  if (usage.totals.replies === 0) return null;

  const fill = contextFill(usage, maxTokens, kiro);
  const { totals } = usage;
  const hasTokens = usage.tokenReplies > 0;
  const hasCredits = usage.kiroReplies > 0;
  const cost = hasTokens ? costText(usage) : undefined;
  const note = fill ? undefined : fillNote(usage, noModel);

  return (
    <Context usedTokens={fill?.used ?? 0} maxTokens={fill?.max ?? 0}>
      {fill ? (
        <ContextTrigger className={chipClass} />
      ) : (
        <ContextTrigger>
          <Button
            type="button"
            variant="ghost"
            aria-label="Usage of this chat"
            title="Usage of this chat"
            className={chipClass}
          >
            <ChartNoAxesColumnIcon aria-hidden className="size-5" />
          </Button>
        </ContextTrigger>
      )}
      <ContextContent side="top" align="end" className="z-[1100]">
        {fill && <ContextContentHeader showTokens={!kiro} />}
        {note && <p className="p-3 text-xs text-muted-foreground">{note}</p>}
        {hasTokens && (
          <ContextContentBody className="space-y-1">
            <p className="pb-1 text-xs font-medium">This chat</p>
            <Row
              label="Input"
              value={formatTokens(totals.inputTokens)}
              detail={
                totals.cacheReadTokens
                  ? `${formatTokens(totals.cacheReadTokens)} cached`
                  : undefined
              }
            />
            <Row
              label="Output"
              value={formatTokens(totals.outputTokens)}
              detail={
                totals.reasoningTokens
                  ? `${formatTokens(totals.reasoningTokens)} reasoning`
                  : undefined
              }
            />
          </ContextContentBody>
        )}
        {(kiro || hasCredits) && (
          <ContextContentBody className="empty:hidden">
            <KiroUsageLine label="Kiro account" className="text-xs" />
          </ContextContentBody>
        )}
        {cost && (
          <ContextContentFooter>
            <span className="text-muted-foreground">Cost</span>
            <span className="text-right tabular-nums">
              {cost.value}
              {cost.note && <span className="block text-muted-foreground">{cost.note}</span>}
            </span>
          </ContextContentFooter>
        )}
        {hasCredits && (
          <ContextContentFooter>
            <span className="text-muted-foreground">Credits in this chat</span>
            <span className="text-right tabular-nums">{formatCredits(usage.credits)}</span>
          </ContextContentFooter>
        )}
      </ContextContent>
    </Context>
  );
}
