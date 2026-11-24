'use client';

import { type ComponentProps, createContext, useContext } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { type ContextLevel, contextLevel, formatTokens } from '@/utils/usage';

const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** 12%, 0.4%, and <0.1% for a small chat in a large window, so a used context never reads 0% */
const formatPercent = (fraction: number) =>
  fraction > 0 && fraction < 0.001 ? '<0.1%' : percentFormat.format(fraction);

/** Text colour for each level, also on hover. Words go with the colour, so colour is never the only signal. */
const LEVEL_TEXT: Record<ContextLevel, string> = {
  ok: 'text-muted-foreground',
  near: 'text-status-warn hover:text-status-warn',
  full: 'text-status-error hover:text-status-error',
};

const LEVEL_BAR: Record<ContextLevel, string> = {
  ok: '',
  near: 'bg-status-warn/20 [&>div]:bg-status-warn',
  full: 'bg-status-error/20 [&>div]:bg-status-error',
};

type ContextSchema = {
  usedTokens: number;
  maxTokens: number;
  level: ContextLevel;
  /** usedTokens / maxTokens, not capped */
  fraction: number;
};

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = () => {
  const context = useContext(ContextContext);
  if (!context) {
    throw new Error('Context components must be used within Context');
  }
  return context;
};

export type ContextProps = ComponentProps<typeof Popover> & {
  usedTokens: number;
  maxTokens: number;
};

// A Popover, not a HoverCard, so click, tap, Enter and Space open the breakdown and screen
// readers reach it. Click-only avoids the WCAG 1.4.13 hoverable requirement.
export const Context = ({ usedTokens, maxTokens, ...props }: ContextProps) => (
  <ContextContext.Provider
    value={{
      usedTokens,
      maxTokens,
      level: contextLevel(usedTokens, maxTokens),
      fraction: maxTokens > 0 ? usedTokens / maxTokens : 0,
    }}
  >
    <Popover {...props} />
  </ContextContext.Provider>
);

const ContextIcon = () => {
  const { fraction } = useContextValue();
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const dashOffset = circumference * (1 - Math.min(fraction, 1));

  return (
    <svg aria-hidden height="20" viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} width="20">
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.85"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transformOrigin: 'center', transform: 'rotate(-90deg)' }}
      />
    </svg>
  );
};

/** "Near the limit" or "Almost full", or undefined below 70% */
function levelLabel(level: ContextLevel): string | undefined {
  if (level === 'near') return 'Near the limit';
  if (level === 'full') return 'Almost full';
  return undefined;
}

export type ContextTriggerProps = ComponentProps<typeof Button>;

export const ContextTrigger = ({ children, className, ...props }: ContextTriggerProps) => {
  const { fraction, level } = useContextValue();
  const percent = formatPercent(fraction);
  const label = levelLabel(level);

  return (
    <PopoverTrigger asChild>
      {children ?? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`Context used: ${percent}${label ? `, ${label.toLowerCase()}` : ''}`}
          data-level={level}
          className={cn(className, level !== 'ok' && LEVEL_TEXT[level])}
          {...props}
        >
          <span className="font-medium">{percent}</span>
          <ContextIcon />
        </Button>
      )}
    </PopoverTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof PopoverContent>;

export const ContextContent = ({ className, ...props }: ContextContentProps) => (
  <PopoverContent
    className={cn('w-72 min-w-60 divide-y overflow-hidden p-0', className)}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<'div'>;

/** Percentage, tokens used of the window, a bar, and the level in words */
export const ContextContentHeader = ({ className, ...props }: ContextContentHeaderProps) => {
  const { usedTokens, maxTokens, fraction, level } = useContextValue();
  const label = levelLabel(level);

  return (
    <div className={cn('w-full space-y-2 p-3 text-xs tabular-nums', className)} {...props}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{formatPercent(fraction)} of the context window</p>
        <p className="text-muted-foreground">
          {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
        </p>
      </div>
      <Progress
        className={cn('bg-muted', LEVEL_BAR[level])}
        value={Math.min(fraction, 1) * PERCENT_MAX}
        aria-label="Context used"
      />
      {label && (
        <p className={cn('font-medium', LEVEL_TEXT[level])}>
          {label}.{' '}
          <span className="font-normal text-muted-foreground">
            {level === 'full'
              ? 'A reply can fail when the window is full. Start a new chat.'
              : 'Each reply sends the whole chat again. A new chat sends less.'}
          </span>
        </p>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<'div'>;

export const ContextContentBody = ({ className, ...props }: ContextContentBodyProps) => (
  <div className={cn('w-full p-3', className)} {...props} />
);

export type ContextContentFooterProps = ComponentProps<'div'>;

export const ContextContentFooter = ({ className, ...props }: ContextContentFooterProps) => (
  <div
    className={cn(
      'flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs',
      className
    )}
    {...props}
  />
);
