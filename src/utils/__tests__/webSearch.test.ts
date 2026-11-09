import { describe, expect, it } from 'vitest';

import {
  WEB_SEARCH_HEADER_NAMES,
  buildWebSearchHeaders,
  getPrimaryWebSearchProvider,
  getWebSearchOrder,
} from '../webSearch';

describe('getPrimaryWebSearchProvider', () => {
  it('is undefined when no key is set', () => {
    expect(getPrimaryWebSearchProvider({})).toBeUndefined();
    expect(getPrimaryWebSearchProvider({ braveApiKey: '  ' })).toBeUndefined();
  });

  it('uses the chosen provider when its key is set', () => {
    expect(
      getPrimaryWebSearchProvider({ webSearchProvider: 'exa', exaApiKey: 'e', braveApiKey: 'b' })
    ).toBe('exa');
  });

  it('uses the first provider with a key when the chosen one has no key', () => {
    expect(getPrimaryWebSearchProvider({ webSearchProvider: 'brave', tavilyApiKey: 't' })).toBe(
      'tavily'
    );
  });

  it('keeps Tavily as the primary provider for existing users', () => {
    expect(getPrimaryWebSearchProvider({ tavilyApiKey: 'tvly-1' })).toBe('tavily');
  });
});

describe('getWebSearchOrder', () => {
  const allKeys = { braveApiKey: 'b', exaApiKey: 'e', tavilyApiKey: 't' };

  it('puts the primary provider first, then the others that have a key', () => {
    expect(getWebSearchOrder({ ...allKeys, webSearchProvider: 'tavily' })).toEqual([
      'tavily',
      'brave',
      'exa',
    ]);
    expect(
      getWebSearchOrder({ exaApiKey: 'e', tavilyApiKey: 't', webSearchProvider: 'exa' })
    ).toEqual(['exa', 'tavily']);
  });

  it('uses only the primary provider when fallback is off', () => {
    expect(
      getWebSearchOrder({ ...allKeys, webSearchProvider: 'exa', webSearchFallback: false })
    ).toEqual(['exa']);
  });
});

describe('buildWebSearchHeaders', () => {
  it('is empty when no key is set', () => {
    expect(buildWebSearchHeaders({})).toEqual({});
  });

  it('sends the order and only the keys in it', () => {
    expect(
      buildWebSearchHeaders({
        braveApiKey: ' b ',
        exaApiKey: 'e',
        tavilyApiKey: 't',
        webSearchProvider: 'brave',
        webSearchFallback: false,
      })
    ).toEqual({ 'X-Web-Search-Order': 'brave', 'X-Brave-Api-Key': 'b' });
  });

  it('lists every header for CORS', () => {
    expect(WEB_SEARCH_HEADER_NAMES).toBe(
      'X-Brave-Api-Key, X-Exa-Api-Key, X-Tavily-Api-Key, X-Web-Search-Order'
    );
  });
});
