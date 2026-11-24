'use client';

/**
 * The work row: one line above an answer that says what the model did before it answered
 * (thinking, web searches, tool calls). While the reply runs, the line shows the step that
 * runs now; after it, a summary such as "Thought 4 s · 3 searches · 18 sources". Click the
 * line to see each step.
 */
import { ChevronRight, Loader2 } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { memo, useState } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

import type { ToolCallPart } from '../../types/ai-messages';
import { currentStep, summarizeWork, thoughtLabel } from '../../utils/workSummary';
import { replyRehypePlugins } from './reply-plugins';
import { useStreamdownCode } from './streamdown-code';
import { ToolCall } from './tool-call';

export interface WorkRowProps {
  /** The model's thinking text, when it sent any */
  reasoning?: string;
  reasoningMs?: number;
  toolCalls: ToolCallPart[];
  /** This reply is streaming now */
  isRunning: boolean;
  /** The answer text has started */
  hasText: boolean;
  className?: string;
}

export const WorkRow = memo(
  ({ reasoning, reasoningMs, toolCalls, isRunning, hasText, className }: WorkRowProps) => {
    const [open, setOpen] = useState(false);
    const codeProps = useStreamdownCode();
    const hasReasoning = Boolean(reasoning);

    const step = isRunning ? currentStep({ hasReasoning, hasText, toolCalls }) : undefined;
    const summary = summarizeWork({ hasReasoning, reasoningMs, toolCalls });

    return (
      <Collapsible open={open} onOpenChange={setOpen} className={cn('w-full', className)}>
        <CollapsibleTrigger
          className="flex max-w-full items-center gap-1.5 rounded py-0.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-running={step ? '' : undefined}
        >
          {step ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
                open && 'rotate-90'
              )}
              aria-hidden
            />
          )}
          <span className="truncate tabular-nums">
            {step ?? summary.parts.join(' · ')}
            {!step && summary.failed > 0 && (
              <>
                {summary.parts.length > 0 && ' · '}
                <span className="text-destructive">{summary.failed} failed</span>
              </>
            )}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
          <ol className="mt-1.5 space-y-1 border-l pl-3" aria-label="Steps">
            {hasReasoning && (
              <li className="pb-1">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {isRunning && !hasText && toolCalls.length === 0
                    ? 'Thinking'
                    : thoughtLabel(reasoningMs)}
                </p>
                <Streamdown
                  className="reply-text space-y-2 text-sm text-muted-foreground [--reply-font-size:0.875rem]"
                  rehypePlugins={replyRehypePlugins}
                  {...codeProps}
                >
                  {reasoning ?? ''}
                </Streamdown>
              </li>
            )}
            {toolCalls.map((toolCall) => (
              <ToolCall key={toolCall.toolCallId} toolCall={toolCall} />
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

WorkRow.displayName = 'WorkRow';
