/**
 * Tool Call Component
 *
 * Displays tool invocations (like web search) in chat messages.
 * Shows the tool name, arguments, and results in a collapsible format.
 */
import { ChevronDown, ChevronRight, ExternalLink, Globe, Loader2 } from 'lucide-react';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import type { ToolCallPart } from '../../types/ai-messages';

interface ToolCallProps {
  toolCall: ToolCallPart;
  className?: string;
}

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilySearchResponse {
  results?: TavilySearchResult[];
  answer?: string;
  query?: string;
}

export function ToolCall({ toolCall, className }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isWebSearch = toolCall.toolName === 'webSearch' || toolCall.toolName === 'tavily_search';
  const isPending = toolCall.status === 'pending';
  const isError = toolCall.status === 'error';

  // Parse search results if this is a web search
  const searchResults = isWebSearch ? parseSearchResults(toolCall.result) : null;

  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/30 text-sm my-2',
        isError && 'border-destructive/50',
        className
      )}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full p-3 text-left hover:bg-muted/50 transition-colors"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}

        {isWebSearch && <Globe className="h-4 w-4 text-blue-500" />}

        <span className="font-medium">{isWebSearch ? 'Web Search' : toolCall.toolName}</span>

        {toolCall.args?.query !== undefined && (
          <span className="text-muted-foreground truncate flex-1">
            &quot;{String(toolCall.args.query)}&quot;
          </span>
        )}

        {isPending && <span className="text-xs text-muted-foreground">Searching...</span>}

        {isError && <span className="text-xs text-destructive">Error</span>}

        {searchResults && searchResults.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {isExpanded && !isPending && (
        <div className="px-3 pb-3 border-t border-border/50">
          {isError && toolCall.result !== undefined && (
            <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
              {typeof toolCall.result === 'string'
                ? toolCall.result
                : JSON.stringify(toolCall.result)}
            </div>
          )}

          {searchResults && searchResults.length > 0 && (
            <div className="mt-2 space-y-2">
              {searchResults.map((result, index) => (
                <SearchResultItem key={index} result={result} />
              ))}
            </div>
          )}

          {!isError && !searchResults && toolCall.result !== undefined && (
            <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto">
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

function SearchResultItem({ result }: { result: TavilySearchResult }) {
  return (
    <div className="p-2 rounded bg-background border">
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-primary hover:underline font-medium text-sm"
      >
        {result.title}
        <ExternalLink className="h-3 w-3" />
      </a>
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{result.content}</p>
      <span className="text-xs text-muted-foreground/70 truncate block mt-1">
        {new URL(result.url).hostname}
      </span>
    </div>
  );
}

function parseSearchResults(result: unknown): TavilySearchResult[] | null {
  if (!result) return null;

  // Handle Tavily response format
  if (typeof result === 'object' && result !== null) {
    const response = result as TavilySearchResponse;
    if (response.results && Array.isArray(response.results)) {
      return response.results;
    }
  }

  // Handle array of results directly
  if (Array.isArray(result)) {
    return result.filter(
      (r): r is TavilySearchResult =>
        typeof r === 'object' && r !== null && 'url' in r && 'title' in r
    );
  }

  return null;
}
