/**
 * Reading tool results for the work row, and the compact form that is stored with a reply.
 *
 * Keep this file free of DOM and Node imports.
 */
import type { ToolCallPart } from '../types/ai-messages';
import { WEB_SEARCH_PROVIDER_LABELS, isWebSearchProvider } from './webSearch';

/** One web search result. Older chats saved Tavily results, which have the same fields. */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/** Web search tool output: see server/web-search.ts */
interface SearchResponse {
  results?: unknown[];
  provider?: string;
  failures?: unknown[];
  error?: string;
}

export interface SearchInfo {
  providerLabel?: string;
  failures?: string[];
  error?: string;
}

/** A tool call that is stored with its reply */
export type StoredToolCall = Omit<ToolCallPart, 'type'>;

/** Most results kept for one stored search, and the most characters kept for other output */
const STORED_RESULTS = 10;
const STORED_SNIPPET = 400;
const STORED_OUTPUT = 8000;

export function isWebSearchTool(toolName: string): boolean {
  return toolName === 'webSearch' || toolName === 'tavily_search';
}

/** The tool name without the MCP server prefix: `fetchv2__fetch` is `fetch` */
export function shortToolName(toolName: string): string {
  const name = toolName.includes('__') ? toolName.slice(toolName.lastIndexOf('__') + 2) : toolName;
  return name || toolName;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const isSearchResult = (r: unknown): r is SearchResult =>
  typeof r === 'object' &&
  r !== null &&
  typeof (r as SearchResult).url === 'string' &&
  typeof (r as SearchResult).title === 'string';

/** The results of a web search, or null when the output is not a search response */
export function parseSearchResults(result: unknown): SearchResult[] | null {
  if (!result) return null;
  if (Array.isArray(result)) return result.filter(isSearchResult);
  if (typeof result === 'object') {
    const response = result as SearchResponse;
    if (Array.isArray(response.results)) return response.results.filter(isSearchResult);
  }
  return null;
}

export function parseSearchInfo(result: unknown): SearchInfo {
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

/**
 * Tool output as text. MCP tools return `{ content: [{ type: 'text', text }] }`; the text parts
 * are joined. Other values are shown as JSON.
 */
export function toolResultText(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)) {
    const texts = (result as { content: unknown[] }).content
      .map((c) =>
        c && typeof c === 'object' && (c as { type?: unknown }).type === 'text'
          ? (c as { text?: unknown }).text
          : undefined
      )
      .filter((t): t is string => typeof t === 'string');
    if (texts.length) return texts.join('\n\n');
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The tool call as it is stored with the reply. Search results keep their title, link and a
 * short snippet; other output keeps its first 8,000 characters. A call that has no result when
 * the reply ends is stored as failed.
 */
export function toStoredToolCall(part: ToolCallPart): StoredToolCall {
  const status = part.status === 'pending' ? 'error' : part.status;
  let result: unknown;
  if (part.status === 'pending') {
    result = 'The reply ended before this tool returned a result.';
  } else if (isWebSearchTool(part.toolName) && parseSearchResults(part.result)) {
    const info = parseSearchInfo(part.result);
    const raw = part.result as SearchResponse;
    result = {
      ...(typeof raw.provider === 'string' && { provider: raw.provider }),
      ...(info.failures?.length && { failures: info.failures }),
      ...(info.error && { error: info.error }),
      results: (parseSearchResults(part.result) ?? []).slice(0, STORED_RESULTS).map((r) => ({
        title: cut(r.title, 200),
        url: cut(r.url, 2000),
        content: cut(typeof r.content === 'string' ? r.content : '', STORED_SNIPPET),
      })),
    };
  } else if (part.result !== undefined) {
    result = cut(toolResultText(part.result), STORED_OUTPUT);
  }
  return {
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args: part.args,
    status,
    ...(result !== undefined && { result }),
  };
}
