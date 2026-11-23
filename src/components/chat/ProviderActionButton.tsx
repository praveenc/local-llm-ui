/**
 * The one action that fixes an unavailable provider: copy a command, open a docs page, or open
 * Preferences.
 */
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ProviderAction } from './providerHelp';

interface ProviderActionButtonProps {
  action: ProviderAction;
  onOpenPreferences?: () => void;
  className?: string;
}

export function ProviderActionButton({
  action,
  onOpenPreferences,
  className,
}: ProviderActionButtonProps) {
  const classes = cn('h-7 shrink-0 px-2 text-xs', className);

  if (action.kind === 'link') {
    return (
      <Button asChild variant="outline" size="sm" className={classes}>
        <a href={action.href} target="_blank" rel="noreferrer">
          {action.label}
        </a>
      </Button>
    );
  }

  const handleClick = async () => {
    if (action.kind === 'preferences') {
      onOpenPreferences?.();
      return;
    }
    try {
      await navigator.clipboard.writeText(action.value);
      toast.success(`Copied: ${action.value}`);
    } catch {
      toast.error(`Could not copy. Run: ${action.value}`);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" className={classes} onClick={handleClick}>
      {action.label}
    </Button>
  );
}
