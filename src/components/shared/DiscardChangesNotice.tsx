import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DiscardChangesNoticeProps {
  onDiscard: () => void;
  className?: string;
}

/**
 * Shown when a dialog with unsaved edits was asked to close. Focus moves to Discard, and
 * the message is its description, so a screen reader says why the dialog stayed open.
 */
export function DiscardChangesNotice({ onDiscard, className }: DiscardChangesNoticeProps) {
  const messageId = useId();
  return (
    <div className={cn('flex items-center justify-end gap-3', className)}>
      <p id={messageId} className="text-sm text-muted-foreground">
        You have unsaved changes.
      </p>
      <Button
        type="button"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={onDiscard}
        aria-describedby={messageId}
        autoFocus
      >
        Discard
      </Button>
    </div>
  );
}
