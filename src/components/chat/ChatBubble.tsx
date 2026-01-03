import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface ChatBubbleProps {
  type: 'incoming' | 'outgoing';
  avatar?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function ChatBubble({
  type,
  avatar,
  actions,
  children,
  className,
  ariaLabel,
}: ChatBubbleProps) {
  const isIncoming = type === 'incoming';

  return (
    <div
      className={cn('flex gap-3', isIncoming ? 'flex-row' : 'flex-row-reverse', className)}
      role="article"
      aria-label={ariaLabel}
    >
      {avatar && <div className="flex-shrink-0 pt-1">{avatar}</div>}
      <div className={cn('flex flex-col gap-1 max-w-[85%]', !isIncoming && 'items-end')}>
        <div
          className={cn(
            'rounded-lg px-4 py-3 text-sm',
            isIncoming
              ? 'bg-card text-card-foreground border border-border'
              : 'bg-primary text-primary-foreground'
          )}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">{children}</div>
        </div>
        {actions && (
          <div className={cn('flex gap-1', isIncoming ? 'justify-start' : 'justify-end')}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
