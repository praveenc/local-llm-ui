/**
 * ContextIndicator Component
 *
 * Displays context window usage in the PromptInput footer.
 * Shows percentage used with hover card for detailed breakdown.
 */
import type { LanguageModelUsage } from 'ai';

import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from '../ai-elements/context';

interface ContextIndicatorProps {
  usedTokens: number;
  maxTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
}

export function ContextIndicator({
  usedTokens,
  maxTokens,
  inputTokens = 0,
  outputTokens = 0,
  modelId,
}: ContextIndicatorProps) {
  // Don't show if no tokens used yet
  if (usedTokens === 0) {
    return null;
  }

  // Create usage object - cast to satisfy LanguageModelUsage type
  // The context component only uses inputTokens, outputTokens, totalTokens
  const usage = {
    inputTokens,
    outputTokens,
    totalTokens: usedTokens,
  } as LanguageModelUsage;

  return (
    <Context usedTokens={usedTokens} maxTokens={maxTokens} usage={usage} modelId={modelId}>
      <ContextTrigger className="h-7 px-2 text-xs" />
      <ContextContent side="top" align="end" className="z-[1100]">
        <ContextContentHeader />
        <ContextContentBody className="space-y-1">
          <ContextInputUsage />
          <ContextOutputUsage />
        </ContextContentBody>
        {modelId && <ContextContentFooter />}
      </ContextContent>
    </Context>
  );
}
