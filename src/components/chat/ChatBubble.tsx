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
      className={cn('w-full', isIncoming ? 'pr-[25%]' : 'pl-[25%]', className)}
      role="article"
      aria-label={ariaLabel}
    >
      <div className={cn('flex gap-3', isIncoming ? 'flex-row' : 'flex-row-reverse')}>
        {avatar && <div className="flex-shrink-0 pt-1">{avatar}</div>}
        <div className={cn('flex flex-col gap-1 min-w-0', !isIncoming && 'items-end')}>
          <div
            className={cn(
              'rounded-2xl px-4 py-3 text-sm max-w-full overflow-hidden',
              isIncoming
                ? 'bg-muted text-foreground rounded-tl-sm'
                : 'bg-primary text-primary-foreground rounded-tr-sm'
            )}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0 overflow-hidden">
              {children}
            </div>
          </div>
          {actions && (
            <div className={cn('flex gap-1', isIncoming ? 'justify-start' : 'justify-end')}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
