// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebSearchProviders, searchWeb } from '../web-search';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const BRAVE_OK = {
  web: {
    results: [
      {
        title: 'Brave result',
        url: 'https://example.com/a',
        description: 'Snippet',
        extra_snippets: ['More'],
        page_age: '2026-11-01T00:00:00',
      },
      { title: 'No URL' },
    ],
  },
};

const EXA_OK = {
  results: [
    {
      title: null,
      url: 'https://example.com/b',
      publishedDate: '2026-10-01T00:00:00.000Z',
      highlights: ['Highlight one', 'Highlight two'],
    },
  ],
};

const TAVILY_OK = {
  results: [{ title: 'Tavily result', url: 'https://example.com/c', content: 'Content' }],
};

describe('getWebSearchProviders', () => {
  it('follows the order header and skips providers with no key', () => {
    expect(
      getWebSearchProviders({
        'x-web-search-order': 'exa, brave,tavily,unknown,exa',
        'x-exa-api-key': 'e',
        'x-tavily-api-key': ' t ',
      })
    ).toEqual([
      { provider: 'exa', apiKey: 'e' },
      { provider: 'tavily', apiKey: 't' },
    ]);
  });

  it('uses the default order without an order header', () => {
    expect(
      getWebSearchProviders({ 'x-tavily-api-key': 't', 'x-brave-api-key': 'b' }).map(
        (p) => p.provider
      )
    ).toEqual(['brave', 'tavily']);
  });
});

describe('searchWeb', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls Brave with the subscription token and maps the results', async () => {
    fetchMock.mockResolvedValueOnce(json(200, BRAVE_OK));

    const output = await searchWeb([{ provider: 'brave', apiKey: 'b-key' }], 'test', 'week');

    const [url, init] = fetchMock.mock.calls[0];
    const requestUrl = new URL(String(url));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      'https://api.search.brave.com/res/v1/web/search'
    );
    expect(requestUrl.searchParams.get('q')).toBe('test');
    expect(requestUrl.searchParams.get('freshness')).toBe('pw');
    expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('b-key');
    expect(output).toEqual({
      query: 'test',
      provider: 'brave',
      results: [
        {
          title: 'Brave result',
          url: 'https://example.com/a',
          content: 'Snippet\nMore',
          publishedDate: '2026-11-01T00:00:00',
        },
      ],
    });
  });

  it('calls Exa with highlights and maps the results', async () => {
    fetchMock.mockResolvedValueOnce(json(200, EXA_OK));

    const output = await searchWeb([{ provider: 'exa', apiKey: 'e-key' }], 'test');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('e-key');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ query: 'test', numResults: 5, contents: { highlights: {} } });
    expect(body.startPublishedDate).toBeUndefined();
    expect(output.results).toEqual([
      {
        title: 'https://example.com/b',
        url: 'https://example.com/b',
        content: 'Highlight one\nHighlight two',
        publishedDate: '2026-10-01T00:00:00.000Z',
      },
    ]);
  });

  it('calls Tavily with a bearer token', async () => {
    fetchMock.mockResolvedValueOnce(json(200, TAVILY_OK));

    const output = await searchWeb([{ provider: 'tavily', apiKey: 't-key' }], 'test', 'day');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({ time_range: 'day', max_results: 5 });
    expect(output.provider).toBe('tavily');
    expect(output.results[0].content).toBe('Content');
  });

  it('falls back to the next provider when one fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(429, { error: { code: 'RATE_LIMITED', detail: 'Too many requests' } })
      )
      .mockResolvedValueOnce(json(402, { error: 'No more credits', tag: 'NO_MORE_CREDITS' }))
      .mockResolvedValueOnce(json(200, TAVILY_OK));

    const output = await searchWeb(
      [
        { provider: 'brave', apiKey: 'b' },
        { provider: 'exa', apiKey: 'e' },
        { provider: 'tavily', apiKey: 't' },
      ],
      'test'
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(output.provider).toBe('tavily');
    expect(output.failures).toEqual([
      'Brave Search: HTTP 429 (RATE_LIMITED: Too many requests)',
      'Exa: HTTP 402 (NO_MORE_CREDITS: No more credits)',
    ]);
  });

  it('returns the errors when all providers fail', async () => {
    fetchMock
      .mockResolvedValueOnce(json(432, { detail: { error: 'Plan limit exceeded' } }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const output = await searchWeb(
      [
        { provider: 'tavily', apiKey: 't' },
        { provider: 'brave', apiKey: 'b' },
      ],
      'test'
    );

    expect(output.provider).toBeUndefined();
    expect(output.results).toEqual([]);
    expect(output.error).toBe(
      'Web search failed. Tavily: HTTP 432 (Plan limit exceeded); Brave Search: fetch failed'
    );
  });

  it('does not try the next provider when the request is cancelled', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(
      searchWeb(
        [
          { provider: 'brave', apiKey: 'b' },
          { provider: 'exa', apiKey: 'e' },
        ],
        'test',
        undefined,
        controller.signal
      )
    ).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
