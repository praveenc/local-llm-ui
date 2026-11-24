/**
 * ContextIndicator
 *
 * The context ring in the chat input. The ring shows how full the context window was after the
 * last reply. The popover adds the token totals and the cost of the chat.
 */
import type { ChatUsage } from '@/utils/chatUsage';
import { formatCost, formatTokens } from '@/utils/usage';

import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from '../ai-elements/context';
import { composerChip } from './composerStyles';

interface ContextIndicatorProps {
  usage: ChatUsage;
  /** Context window of the selected model */
  maxTokens: number;
}

function Row({ label, tokens, detail }: { label: string; tokens: number; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {formatTokens(tokens)}
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
  return {
    value: formatCost(usage.cost),
    note: unpriced
      ? `${unpriced} ${unpriced === 1 ? 'reply has' : 'replies have'} no price`
      : undefined,
  };
}

export function ContextIndicator({ usage, maxTokens }: ContextIndicatorProps) {
  if (usage.contextTokens === 0) return null;

  const { totals } = usage;
  const cost = costText(usage);

  return (
    <Context usedTokens={usage.contextTokens} maxTokens={maxTokens}>
      <ContextTrigger className={`${composerChip} gap-1 px-2 tabular-nums has-[>svg]:px-2`} />
      <ContextContent side="top" align="end" className="z-[1100]">
        <ContextContentHeader />
        <ContextContentBody className="space-y-1">
          <p className="pb-1 text-xs font-medium">This chat</p>
          <Row
            label="Input"
            tokens={totals.inputTokens}
            detail={
              totals.cacheReadTokens ? `${formatTokens(totals.cacheReadTokens)} cached` : undefined
            }
          />
          <Row
            label="Output"
            tokens={totals.outputTokens}
            detail={
              totals.reasoningTokens
                ? `${formatTokens(totals.reasoningTokens)} reasoning`
                : undefined
            }
          />
        </ContextContentBody>
        <ContextContentFooter>
          <span className="text-muted-foreground">Cost</span>
          <span className="text-right tabular-nums">
            {cost.value}
            {cost.note && <span className="block text-muted-foreground">{cost.note}</span>}
          </span>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}
