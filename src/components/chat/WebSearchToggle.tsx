/**
 * WebSearchToggle Component
 *
 * Toggle button to enable/disable web search (Brave Search, Exa, or Tavily) for the current
 * conversation.
 */
import { Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { composerActive, composerIconButton } from './composerStyles';

interface WebSearchToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  hasApiKey?: boolean;
  /** Provider tried first, shown in the tooltip */
  providerLabel?: string;
}

export function WebSearchToggle({
  enabled,
  onToggle,
  disabled,
  hasApiKey = true,
  providerLabel,
}: WebSearchToggleProps) {
  const via = providerLabel ? ` (${providerLabel})` : '';
  const tooltipText = !hasApiKey
    ? 'Add a Brave Search, Exa, or Tavily API key in preferences to enable web search'
    : enabled
      ? `Web search enabled${via}`
      : `Enable web search${via}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(composerIconButton, enabled && composerActive)}
            disabled={disabled || !hasApiKey}
            aria-label="Web search"
            aria-pressed={enabled}
            onClick={() => onToggle(!enabled)}
          >
            <Globe className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
