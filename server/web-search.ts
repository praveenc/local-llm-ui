/**
 * Web search tool for the server proxies.
 *
 * One `webSearch` tool that calls Brave Search, Exa, or Tavily. It tries the providers in the
 * order that the browser sends. When a provider fails (no quota left, rate limit, bad key,
 * timeout, or outage), it tries the next one. The result has the same shape for all
 * providers, so the chat UI shows it the same way.
 *
 * API keys come from request headers. Do not log them.
 */
import { tool } from 'ai';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';

import {
  WEB_SEARCH_KEY_HEADERS,
  WEB_SEARCH_ORDER_HEADER,
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_LABELS,
  isWebSearchProvider,
} from '../src/utils/webSearch.ts';
import type { WebSearchProvider } from '../src/utils/webSearch.ts';

export interface WebSearchProviderKey {
  provider: WebSearchProvider;
  apiKey: string;
}

export type TimeRange = 'day' | 'week' | 'month' | 'year';

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

export interface WebSearchOutput {
  query: string;
  /** Provider that returned the results. Not set when all providers failed. */
  provider?: WebSearchProvider;
  results: WebSearchResult[];
  /** Providers that failed before a provider returned results, or all of them */
  failures?: string[];
  /** Set when all providers failed */
  error?: string;
}

export const WEB_SEARCH_KEY_REQUIRED_ERROR =
  'Web search needs an API key. Add a Brave Search, Exa, or Tavily key in Preferences > Web Search.';

const MAX_RESULTS = 5;
const MAX_CONTENT_CHARS = 1500;
const MAX_ERROR_CHARS = 200;
export const REQUEST_TIMEOUT_MS = 15_000;

const TIME_RANGE_DAYS: Record<TimeRange, number> = { day: 1, week: 7, month: 31, year: 365 };
const BRAVE_FRESHNESS: Record<TimeRange, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

/**
 * Providers that have a key in the request headers, in the order the browser asked for.
 * Without an order header, uses the default order.
 */
export function getWebSearchProviders(headers: IncomingHttpHeaders): WebSearchProviderKey[] {
  const read = (name: string): string | undefined => {
    const value = headers[name.toLowerCase()];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };

  const order = read(WEB_SEARCH_ORDER_HEADER)
    ?.split(',')
    .map((name) => name.trim()) ?? [...WEB_SEARCH_PROVIDERS];

  const providers: WebSearchProviderKey[] = [];
  for (const name of new Set(order)) {
    if (!isWebSearchProvider(name)) continue;
    const apiKey = read(WEB_SEARCH_KEY_HEADERS[name]);
    if (apiKey) providers.push({ provider: name, apiKey });
  }
  return providers;
}

export function createWebSearchTool(providers: WebSearchProviderKey[]) {
  return tool({
    description:
      'Search the web for current information. Returns the top results, each with a title, URL, and text excerpt.',
    inputSchema: z.object({
      query: z.string().min(1).max(400).describe('The search query'),
      timeRange: z
        .enum(['day', 'week', 'month', 'year'])
        .optional()
        .describe('Only return results published within this recent time range'),
    }),
    execute: ({ query, timeRange }, { abortSignal }) =>
      searchWeb(providers, query, timeRange, abortSignal),
  });
}

/**
 * Search with each provider in turn until one returns results. Does not throw when all
 * providers fail: returns the errors, so the model and the UI can show them. Throws only
 * when the request is cancelled.
 */
export async function searchWeb(
  providers: WebSearchProviderKey[],
  query: string,
  timeRange?: TimeRange,
  abortSignal?: AbortSignal
): Promise<WebSearchOutput> {
  const failures: string[] = [];

  for (const { provider, apiKey } of providers) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
    try {
      const results = await SEARCHERS[provider](apiKey, query, timeRange, signal);
      return { query, provider, results, ...(failures.length > 0 && { failures }) };
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      const failure = `${WEB_SEARCH_PROVIDER_LABELS[provider]}: ${describeError(error)}`;
      console.warn(`[web search] ${failure}`);
      failures.push(failure);
    }
  }

  return {
    query,
    results: [],
    failures,
    error:
      failures.length > 0
        ? `Web search failed. ${failures.join('; ')}`
        : 'Web search failed: no provider has an API key.',
  };
}

type Searcher = (
  apiKey: string,
  query: string,
  timeRange: TimeRange | undefined,
  signal: AbortSignal
) => Promise<WebSearchResult[]>;

// ─── Brave Search ────────────────────────────────────────────────────────────
// https://api-dashboard.search.brave.com/api-reference/web/search/get

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      page_age?: string;
      extra_snippets?: string[];
    }>;
  };
}

const searchBrave: Searcher = async (apiKey, query, timeRange, signal) => {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(MAX_RESULTS));
  url.searchParams.set('result_filter', 'web');
  url.searchParams.set('extra_snippets', 'true');
  url.searchParams.set('text_decorations', 'false');
  if (timeRange) url.searchParams.set('freshness', BRAVE_FRESHNESS[timeRange]);

  const body = (await requestJson(
    url,
    { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } },
    signal
  )) as BraveResponse | undefined;

  return toResults(body?.web?.results, (r) => ({
    title: r.title,
    url: r.url,
    content: [r.description, ...(r.extra_snippets ?? [])],
    publishedDate: r.page_age,
  }));
};

// ─── Exa ─────────────────────────────────────────────────────────────────────
// https://exa.ai/docs/reference/search

interface ExaResponse {
  results?: Array<{
    title?: string | null;
    url?: string;
    publishedDate?: string;
    highlights?: string[];
    text?: string;
  }>;
}

const searchExa: Searcher = async (apiKey, query, timeRange, signal) => {
  const body = (await requestJson(
    'https://api.exa.ai/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        query,
        type: 'auto',
        numResults: MAX_RESULTS,
        contents: { highlights: { maxCharacters: MAX_CONTENT_CHARS } },
        ...(timeRange && { startPublishedDate: startOf(timeRange) }),
      }),
    },
    signal
  )) as ExaResponse | undefined;

  return toResults(body?.results, (r) => ({
    title: r.title,
    url: r.url,
    content: r.highlights ?? [r.text],
    publishedDate: r.publishedDate,
  }));
};

// ─── Tavily ──────────────────────────────────────────────────────────────────
// https://docs.tavily.com/documentation/api-reference/endpoint/search

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string | null;
  }>;
}

const searchTavily: Searcher = async (apiKey, query, timeRange, signal) => {
  const body = (await requestJson(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        max_results: MAX_RESULTS,
        search_depth: 'basic',
        ...(timeRange && { time_range: timeRange }),
      }),
    },
    signal
  )) as TavilyResponse | undefined;

  return toResults(body?.results, (r) => ({
    title: r.title,
    url: r.url,
    content: [r.content],
    publishedDate: r.published_date ?? undefined,
  }));
};

const SEARCHERS: Record<WebSearchProvider, Searcher> = {
  brave: searchBrave,
  exa: searchExa,
  tavily: searchTavily,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RawResult {
  title?: string | null;
  url?: string;
  content: Array<string | undefined>;
  publishedDate?: string;
}

/** Map provider results to the shared shape. Drops results that have no URL. */
function toResults<T>(items: T[] | undefined, map: (item: T) => RawResult): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const item of items ?? []) {
    const { title, url, content, publishedDate } = map(item);
    if (typeof url !== 'string' || !url) continue;
    const text = content
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join('\n');
    results.push({
      title: title?.trim() || url,
      url,
      content: text.slice(0, MAX_CONTENT_CHARS),
      ...(publishedDate && { publishedDate }),
    });
  }
  return results;
}

async function requestJson(
  url: string | URL,
  init: RequestInit,
  signal: AbortSignal
): Promise<unknown> {
  const response = await fetch(url, { ...init, signal });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const detail = errorDetail(body);
    throw new Error(`HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
  }
  return body;
}

/** The error text from a Brave, Exa, or Tavily error body */
function errorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const { error, tag, detail } = body as Record<string, unknown>;
  let text: string | undefined;
  if (error && typeof error === 'object') {
    // Brave: { error: { code, detail } }
    const { code, detail: braveDetail } = error as Record<string, unknown>;
    text = [code, braveDetail].filter((s) => typeof s === 'string').join(': ');
  } else if (typeof error === 'string') {
    // Exa: { error, tag }
    text = typeof tag === 'string' ? `${tag}: ${error}` : error;
  } else if (detail && typeof detail === 'object' && 'error' in detail) {
    // Tavily: { detail: { error } }
    const tavilyError = (detail as { error?: unknown }).error;
    if (typeof tavilyError === 'string') text = tavilyError;
  } else if (typeof detail === 'string') {
    text = detail;
  }
  return text ? text.slice(0, MAX_ERROR_CHARS) : undefined;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no response in ${REQUEST_TIMEOUT_MS / 1000} s`;
  }
  return error instanceof Error ? error.message : String(error);
}

function startOf(timeRange: TimeRange): string {
  return new Date(Date.now() - TIME_RANGE_DAYS[timeRange] * 86_400_000).toISOString();
}
