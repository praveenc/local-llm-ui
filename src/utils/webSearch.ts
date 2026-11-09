/**
 * Web search providers: Brave Search, Exa, and Tavily.
 *
 * Shared by the browser and the server proxies. The browser sends the API keys in headers,
 * together with the order in which the server tries the providers. The server calls the
 * primary provider first. With fallback on, it calls the next provider when one fails (no
 * quota left, rate limit, bad key, or outage).
 */
export type WebSearchProvider = 'brave' | 'exa' | 'tavily';

export const WEB_SEARCH_PROVIDERS: readonly WebSearchProvider[] = ['brave', 'exa', 'tavily'];

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  brave: 'Brave Search',
  exa: 'Exa',
  tavily: 'Tavily',
};

export type WebSearchKeyField = 'braveApiKey' | 'exaApiKey' | 'tavilyApiKey';

export const WEB_SEARCH_KEY_FIELDS: Record<WebSearchProvider, WebSearchKeyField> = {
  brave: 'braveApiKey',
  exa: 'exaApiKey',
  tavily: 'tavilyApiKey',
};

/** The web search part of the user preferences */
export interface WebSearchPreferences {
  braveApiKey?: string;
  exaApiKey?: string;
  tavilyApiKey?: string;
  /** Provider tried first */
  webSearchProvider?: WebSearchProvider;
  /** Try the next provider that has a key when one fails. On when not set. */
  webSearchFallback?: boolean;
}

export const WEB_SEARCH_KEY_HEADERS: Record<WebSearchProvider, string> = {
  brave: 'X-Brave-Api-Key',
  exa: 'X-Exa-Api-Key',
  tavily: 'X-Tavily-Api-Key',
};

/** Comma-separated providers, in the order the server tries them */
export const WEB_SEARCH_ORDER_HEADER = 'X-Web-Search-Order';

/** Request headers that carry web search settings, for CORS allow lists */
export const WEB_SEARCH_HEADER_NAMES = [
  ...WEB_SEARCH_PROVIDERS.map((p) => WEB_SEARCH_KEY_HEADERS[p]),
  WEB_SEARCH_ORDER_HEADER,
].join(', ');

export const isWebSearchProvider = (value: unknown): value is WebSearchProvider =>
  typeof value === 'string' && (WEB_SEARCH_PROVIDERS as readonly string[]).includes(value);

const getKey = (prefs: WebSearchPreferences, provider: WebSearchProvider): string | undefined =>
  prefs[WEB_SEARCH_KEY_FIELDS[provider]]?.trim() || undefined;

export const hasWebSearchKey = (
  prefs: WebSearchPreferences,
  provider: WebSearchProvider
): boolean => getKey(prefs, provider) !== undefined;

/**
 * The provider tried first: the chosen provider if its key is set, else the first provider
 * that has a key. Undefined when no key is set.
 */
export const getPrimaryWebSearchProvider = (
  prefs: WebSearchPreferences
): WebSearchProvider | undefined => {
  const chosen = prefs.webSearchProvider;
  if (chosen && hasWebSearchKey(prefs, chosen)) return chosen;
  return WEB_SEARCH_PROVIDERS.find((p) => hasWebSearchKey(prefs, p));
};

export const isWebSearchFallbackEnabled = (prefs: WebSearchPreferences): boolean =>
  prefs.webSearchFallback !== false;

/**
 * Providers in the order the server tries them. Includes only providers that have a key.
 */
export const getWebSearchOrder = (prefs: WebSearchPreferences): WebSearchProvider[] => {
  const primary = getPrimaryWebSearchProvider(prefs);
  if (!primary) return [];
  if (!isWebSearchFallbackEnabled(prefs)) return [primary];
  return [
    primary,
    ...WEB_SEARCH_PROVIDERS.filter((p) => p !== primary && hasWebSearchKey(prefs, p)),
  ];
};

/**
 * Request headers for the server proxies: the try order and one key header for each
 * provider in it. Empty when no key is set.
 */
export const buildWebSearchHeaders = (prefs: WebSearchPreferences): Record<string, string> => {
  const order = getWebSearchOrder(prefs);
  if (order.length === 0) return {};
  const headers: Record<string, string> = { [WEB_SEARCH_ORDER_HEADER]: order.join(',') };
  for (const provider of order) {
    headers[WEB_SEARCH_KEY_HEADERS[provider]] = getKey(prefs, provider) as string;
  }
  return headers;
};
