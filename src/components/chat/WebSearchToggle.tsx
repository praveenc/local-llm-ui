/**
 * WebSearchToggle Component
 *
 * Turns web search (Brave Search, Exa, or Tavily) on or off for the open chat. The chat input
 * shows it only when a provider has a key.
 */
import { Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  TOOLS_UNSUPPORTED_TEXT,
  composerActive,
  composerChip,
  composerIconButton,
} from './composerStyles';

interface WebSearchToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  /** False when the selected model cannot use tools: the button shows off and does nothing */
  toolsSupported?: boolean;
  /** Provider tried first, shown in the tooltip */
  providerLabel?: string;
}

export function WebSearchToggle({
  enabled,
  onToggle,
  disabled,
  toolsSupported = true,
  providerLabel,
}: WebSearchToggleProps) {
  const via = providerLabel ? ` (${providerLabel})` : '';
  // The model cannot search, so the button shows off; the choice for the chat is kept
  const on = enabled && toolsSupported;
  const tooltipText = !toolsSupported
    ? TOOLS_UNSUPPORTED_TEXT
    : on
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
            className={cn(
              // On: a chip that says "Search", so the state is in words, not only in colour
              on ? cn(composerChip, composerActive) : composerIconButton,
              !toolsSupported && 'cursor-default opacity-50 hover:bg-transparent'
            )}
            disabled={disabled}
            // Stays focusable when the model cannot use tools, so the tooltip can say why
            aria-disabled={!toolsSupported || undefined}
            aria-label="Web search"
            aria-pressed={on}
            onClick={() => {
              if (toolsSupported) onToggle(!enabled);
            }}
          >
            <Globe className="h-4 w-4" />
            {on && <span>Search</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
