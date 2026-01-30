/**
 * WebSearchToggle Component
 *
 * Toggle button to enable/disable Tavily web search for the current conversation.
 */
import { Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface WebSearchToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  hasApiKey?: boolean;
}

export function WebSearchToggle({
  enabled,
  onToggle,
  disabled,
  hasApiKey = true,
}: WebSearchToggleProps) {
  const tooltipText = !hasApiKey
    ? 'Configure Tavily API key in preferences to enable web search'
    : enabled
      ? 'Web search enabled'
      : 'Enable web search';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2',
              enabled
                ? 'text-blue-500 hover:text-blue-600 bg-blue-500/10 hover:bg-blue-500/20'
                : 'text-muted-foreground hover:text-foreground'
            )}
            disabled={disabled || !hasApiKey}
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
