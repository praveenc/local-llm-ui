/**
 * Tool Call Component
 *
 * Displays tool invocations (like web search) in chat messages.
 * Shows the tool name, arguments, and results in a collapsible format.
 */
import { ChevronDown, ChevronRight, ExternalLink, Globe, Loader2, Wrench } from 'lucide-react';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import type { ToolCallPart } from '../../types/ai-messages';
import { argsSummary } from '../../utils/toolCallSummary';
import { WEB_SEARCH_PROVIDER_LABELS, isWebSearchProvider } from '../../utils/webSearch';

interface ToolCallProps {
  toolCall: ToolCallPart;
  className?: string;
}

/** One web search result. Older chats saved Tavily results, which have the same fields. */
interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/** Web search tool output: see server/web-search.ts */
interface SearchResponse {
  results?: SearchResult[];
  provider?: string;
  failures?: string[];
  error?: string;
}

export function ToolCall({ toolCall, className }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isWebSearch = toolCall.toolName === 'webSearch' || toolCall.toolName === 'tavily_search';
  const isPending = toolCall.status === 'pending';
  const isError = toolCall.status === 'error';

  // Parse search results if this is a web search
  const searchResults = isWebSearch ? parseSearchResults(toolCall.result) : null;
  const searchInfo = isWebSearch ? parseSearchInfo(toolCall.result) : {};
  const searchFailed = Boolean(searchInfo.error) && !searchResults?.length;
  const showError = isError || searchFailed;
  const summary = argsSummary(toolCall.args);

  return (
    <div
      className={cn(
        'rounded-md border bg-muted/30 text-xs',
        showError && 'border-destructive/50',
        className
      )}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : isExpanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        {isWebSearch ? (
          <Globe className="size-3.5 shrink-0 text-blue-500" />
        ) : (
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="font-medium shrink-0">
          {isWebSearch ? 'Web Search' : toolCall.toolName}
        </span>

        {summary && (
          <span className="text-muted-foreground truncate flex-1" title={summary}>
            {isWebSearch ? `“${summary}”` : summary}
          </span>
        )}

        {isPending && <span className="text-xs text-muted-foreground">Searching...</span>}

        {showError && <span className="text-xs text-destructive">Error</span>}

        {searchResults && searchResults.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            {searchInfo.providerLabel && ` · ${searchInfo.providerLabel}`}
          </span>
        )}
      </button>

      {isExpanded && !isPending && (
        <div className="px-2 pb-2 border-t border-border/50">
          {isError && toolCall.result !== undefined && (
            <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
              {typeof toolCall.result === 'string'
                ? toolCall.result
                : JSON.stringify(toolCall.result)}
            </div>
          )}

          {searchFailed && (
            <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
              {searchInfo.error}
            </div>
          )}

          {!searchFailed && searchInfo.failures && searchInfo.failures.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Fallback used. {searchInfo.failures.join('; ')}
            </p>
          )}

          {searchResults && searchResults.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {searchResults.map((result, index) => (
                <SearchResultItem key={index} result={result} />
              ))}
            </div>
          )}

          {!isError && !searchResults && !searchFailed && toolCall.result !== undefined && (
            <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto max-h-64">
              {typeof toolCall.result === 'string'
                ? toolCall.result
                : JSON.stringify(toolCall.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function SearchResultItem({ result }: { result: SearchResult }) {
  return (
    <div className="px-2 py-1.5 rounded bg-background border">
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-primary hover:underline font-medium"
      >
        <span className="truncate">{result.title}</span>
        <ExternalLink className="size-3 shrink-0" />
        <span className="ml-auto shrink-0 font-normal text-muted-foreground/70">
          {hostnameOf(result.url)}
        </span>
      </a>
      <p className="text-muted-foreground mt-0.5 line-clamp-2">{result.content}</p>
    </div>
  );
}

function parseSearchInfo(result: unknown): {
  providerLabel?: string;
  failures?: string[];
  error?: string;
} {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const { provider, failures, error } = result as SearchResponse;
  return {
    providerLabel: isWebSearchProvider(provider) ? WEB_SEARCH_PROVIDER_LABELS[provider] : undefined,
    failures: Array.isArray(failures)
      ? failures.filter((f): f is string => typeof f === 'string')
      : undefined,
    error: typeof error === 'string' ? error : undefined,
  };
}

const isSearchResult = (r: unknown): r is SearchResult =>
  typeof r === 'object' &&
  r !== null &&
  typeof (r as SearchResult).url === 'string' &&
  typeof (r as SearchResult).title === 'string';

function parseSearchResults(result: unknown): SearchResult[] | null {
  if (!result) return null;

  // Handle array of results directly
  if (Array.isArray(result)) {
    return result.filter(isSearchResult);
  }

  // Handle the tool output format (and the older Tavily format)
  if (typeof result === 'object') {
    const response = result as SearchResponse;
    if (Array.isArray(response.results)) {
      return response.results.filter(isSearchResult);
    }
  }

  return null;
}
