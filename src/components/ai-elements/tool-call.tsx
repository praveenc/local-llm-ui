/**
 * One tool call in the work row: a line with the tool, its main argument and its outcome.
 * Click the line to see the results (web search) or the output (other tools). Kiro's open
 * question shows under the line; after it, the line says the answer in words.
 */
import { ChevronRight, ExternalLink, Globe, Loader2, Wrench } from 'lucide-react';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import type { ToolCallPart } from '../../types/ai-messages';
import { approvalOutcome, approvalWords, openQuestion } from '../../utils/kiroPermissions';
import { argsSummary } from '../../utils/toolCallSummary';
import {
  type SearchResult,
  hostnameOf,
  isToolCallFailed,
  isWebSearchTool,
  parseSearchInfo,
  parseSearchResults,
  shortToolName,
  toolResultText,
} from '../../utils/toolResults';
import { PermissionQuestion } from './permission-question';

interface ToolCallProps {
  toolCall: ToolCallPart;
  className?: string;
}

/** The most result domains listed under a search line */
const MAX_DOMAINS = 4;

export function ToolCall({ toolCall, className }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isWebSearch = isWebSearchTool(toolCall.toolName);
  const question = openQuestion(toolCall.approvals);
  // A question that ended without an answer, or a denied tool, ends a tool that is still pending
  const isPending = toolCall.status === 'pending' && !approvalOutcome(toolCall.approvals);
  const answers = (toolCall.approvals ?? [])
    .filter((a) => a.state !== 'open')
    .map(approvalWords)
    .join(' · ');
  const isError = toolCall.status === 'error';

  const searchResults = isWebSearch ? parseSearchResults(toolCall.result) : null;
  const searchInfo = isWebSearch ? parseSearchInfo(toolCall.result) : {};
  const showError = isToolCallFailed(toolCall);
  const searchFailed = showError && !isError;
  const summary = argsSummary(toolCall.args);
  const name = isWebSearch ? 'Web search' : shortToolName(toolCall.toolName);
  const domains = [...new Set((searchResults ?? []).map((r) => hostnameOf(r.url)))];
  const output =
    !isWebSearch || (!searchResults && !searchFailed) ? toolResultText(toolCall.result) : '';

  return (
    <li className={cn('text-xs', className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isPending ? undefined : isExpanded}
        className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:hover:bg-transparent"
        disabled={isPending}
        title={toolCall.toolName}
      >
        {isPending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
              isExpanded && 'rotate-90'
            )}
            aria-hidden
          />
        )}
        {isWebSearch ? (
          <Globe className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <Wrench className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="shrink-0 font-medium text-foreground">{name}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate" title={summary}>
            {isWebSearch ? `“${summary}”` : summary}
          </span>
        )}
        {question ? (
          <span className="ml-auto shrink-0">Waiting for your answer</span>
        ) : (
          isPending && (
            <span className="ml-auto shrink-0">{isWebSearch ? 'Searching…' : 'Running…'}</span>
          )
        )}
        {!question && (answers || showError) && (
          <span className="ml-auto shrink-0">
            {answers}
            {showError && (
              <>
                {answers && ' · '}
                <span className="text-destructive">Failed</span>
              </>
            )}
          </span>
        )}
        {searchResults && searchResults.length > 0 && (
          <span className="ml-auto shrink-0 tabular-nums">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            {searchInfo.providerLabel && ` · ${searchInfo.providerLabel}`}
          </span>
        )}
      </button>

      {question && <PermissionQuestion key={question.requestId} approval={question} />}

      {/* The sites a search found, without a second click */}
      {domains.length > 0 && !isExpanded && (
        <p className="truncate pb-1 pl-12 text-muted-foreground">
          {domains.slice(0, MAX_DOMAINS).join(' · ')}
          {domains.length > MAX_DOMAINS && ` · ${domains.length - MAX_DOMAINS} more`}
        </p>
      )}

      {isExpanded && !isPending && (
        <div className="space-y-1.5 pb-2 pl-6 pr-1 pt-1">
          {searchFailed && (
            <p className="rounded bg-destructive/10 p-2 text-destructive">{searchInfo.error}</p>
          )}
          {!searchFailed && searchInfo.failures && searchInfo.failures.length > 0 && (
            <p className="text-muted-foreground">Fallback used. {searchInfo.failures.join('; ')}</p>
          )}
          {searchResults?.map((result, index) => (
            <SearchResultItem key={index} result={result} />
          ))}
          {output && (
            <pre
              className={cn(
                'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded p-2 font-mono',
                isError ? 'bg-destructive/10 text-destructive' : 'bg-muted'
              )}
            >
              {output}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function SearchResultItem({ result }: { result: SearchResult }) {
  return (
    <div className="rounded border bg-background px-2 py-1.5">
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 font-medium text-tint-text hover:underline"
      >
        <span className="truncate">{result.title}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
        <span className="ml-auto shrink-0 font-normal text-muted-foreground">
          {hostnameOf(result.url)}
        </span>
      </a>
      {result.content && (
        <p className="mt-0.5 line-clamp-2 text-muted-foreground">{result.content}</p>
      )}
    </div>
  );
}
