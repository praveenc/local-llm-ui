// @vitest-environment node
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAISDKProxy } from '../aisdk-proxy';

type UpstreamCall = { url: string; headers: Record<string, string> };

const realFetch = globalThis.fetch;

/** Answer calls to the provider with `answer`; let calls to the test server through */
function stubUpstream(answer: (call: UpstreamCall) => Response | Promise<Response>) {
  const calls: UpstreamCall[] = [];
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    const call = { url, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return Promise.resolve(answer(call));
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Send one models request to the proxy. Returns the status and the parsed body. */
async function listModels(provider: string | null, headers: Record<string, string> = {}) {
  const handler = createAISDKProxy();
  const server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const query = provider === null ? '' : `?provider=${provider}`;
    const response = await realFetch(`http://127.0.0.1:${port}/api/aisdk/models${query}`, {
      headers,
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('AI SDK models route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('anthropic', () => {
    it('calls the Anthropic list with the key and the API version, and maps display_name', async () => {
      const calls = stubUpstream(() =>
        json({
          data: [
            { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
            { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
          ],
          has_more: false,
          last_id: 'claude-haiku-5-5',
        })
      );

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(200);
      expect(body).toEqual({
        provider: 'anthropic',
        models: [
          { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
          { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
        ],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
      expect(calls[0].headers).toEqual({
        'x-api-key': 'sk-ant-test',
        'anthropic-version': '2023-06-01',
      });
      // Anthropic does not take a Bearer token
      expect(calls[0].headers).not.toHaveProperty('Authorization');
    });

    it('follows has_more with after_id', async () => {
      const calls = stubUpstream((call) =>
        call.url.includes('after_id=')
          ? json({
              data: [{ id: 'claude-b', display_name: 'B' }],
              has_more: false,
              last_id: 'claude-b',
            })
          : json({
              data: [{ id: 'claude-a', display_name: 'A' }],
              has_more: true,
              last_id: 'claude-a',
            })
      );

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(200);
      expect((body.models as Array<{ id: string }>).map((m) => m.id)).toEqual([
        'claude-a',
        'claude-b',
      ]);
      expect(calls.map((c) => c.url)).toEqual([
        'https://api.anthropic.com/v1/models?limit=1000',
        'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a',
      ]);
    });

    it('stops after 5 pages when the answer always says there is more', async () => {
      let n = 0;
      const calls = stubUpstream(() => {
        n += 1;
        return json({
          data: [{ id: `claude-${n}`, display_name: `M${n}` }],
          has_more: true,
          last_id: `claude-${n}`,
        });
      });

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(200);
      expect(calls).toHaveLength(5);
      expect(body.models).toHaveLength(5);
    });

    it('stops when has_more is true but last_id is missing', async () => {
      const calls = stubUpstream(() => json({ data: [{ id: 'claude-a' }], has_more: true }));

      const { status } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(200);
      expect(calls).toHaveLength(1);
    });

    it('uses the id as the name when display_name is missing, and skips entries with no string id', async () => {
      stubUpstream(() =>
        json({
          data: [
            { id: 'claude-x' },
            { id: 7 },
            null,
            'text',
            { display_name: 'No id' },
            { id: '' },
          ],
          has_more: false,
        })
      );

      const { body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(body.models).toEqual([{ id: 'claude-x', name: 'claude-x' }]);
    });

    it('answers 502 when the data is not an array', async () => {
      stubUpstream(() => json({ data: 'nope' }));

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(502);
      expect(body).toEqual({ error: 'Invalid response from Anthropic' });
    });

    it('answers with no key before it calls Anthropic', async () => {
      const calls = stubUpstream(() => json({ data: [] }));

      const { status, body } = await listModels('anthropic');

      // Same status as Groq and Cerebras give when the key is missing
      expect(status).toBe(401);
      expect(body).toEqual({ error: 'API key required for anthropic' });
      expect(calls).toHaveLength(0);
    });

    it('passes the upstream status on and caps the error text at 500 characters', async () => {
      stubUpstream(() => new Response('x'.repeat(5000), { status: 429 }));

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(429);
      expect(body.error).toBe('x'.repeat(500));
    });

    it('caps the text of a network error too', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      stubUpstream(() => {
        throw new Error('y'.repeat(5000));
      });

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(500);
      expect((body.error as string).length).toBe(500);
    });

    it('answers 502 when a 2xx body is not JSON', async () => {
      stubUpstream(() => new Response('<html>gateway</html>', { status: 200 }));

      const { status, body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-test' });

      expect(status).toBe(502);
      expect(body).toEqual({ error: 'Invalid response from Anthropic' });
    });

    it.each([
      ['an error status', () => new Response('x-api-key: sk-ant-secret rejected', { status: 400 })],
      [
        'a thrown error',
        () => {
          throw new Error('request failed, headers: {"x-api-key":"sk-ant-secret"}');
        },
      ],
    ])(
      'never gives the key back or logs it, for %s that echoes the headers',
      async (_name, answer) => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const infoLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        stubUpstream(answer);

        const { body } = await listModels('anthropic', { 'X-Api-Key': 'sk-ant-secret' });

        expect(JSON.stringify(body)).not.toContain('sk-ant-secret');
        const logged = JSON.stringify([
          errorLog.mock.calls,
          warnLog.mock.calls,
          infoLog.mock.calls,
        ]);
        expect(logged).not.toContain('sk-ant-secret');
      }
    );
  });

  describe('timeout', () => {
    it.each([
      ['anthropic', 'https://api.anthropic.com/v1/models'],
      ['groq', 'https://api.groq.com/openai/v1/models'],
      ['cerebras', 'https://api.cerebras.ai/v1/models'],
    ])(
      '%s: each upstream call has a 10 s limit and a timeout answers 504',
      async (provider, url) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const timeout = vi
          .spyOn(AbortSignal, 'timeout')
          .mockImplementation(() =>
            AbortSignal.abort(new DOMException('timed out', 'TimeoutError'))
          );
        const seen: string[] = [];
        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
          const target = String(input);
          if (target.startsWith('http://127.0.0.1')) return realFetch(input, init);
          seen.push(target);
          // A stalled upstream: nothing comes until the signal ends
          return init?.signal?.aborted
            ? Promise.reject(init.signal.reason)
            : new Promise<never>(() => {});
        });

        const { status, body } = await listModels(provider, { 'X-Api-Key': 'key-1' });

        expect(timeout).toHaveBeenCalledWith(10_000);
        expect(seen).toHaveLength(1);
        expect(seen[0].startsWith(url)).toBe(true);
        expect(status).toBe(504);
        expect(body.error).toBe(`${provider} did not answer in time`);
      }
    );
  });

  describe('groq and cerebras (unchanged)', () => {
    it.each([
      ['groq', 'https://api.groq.com/openai/v1/models'],
      ['cerebras', 'https://api.cerebras.ai/v1/models'],
    ])('%s: Bearer key, owned_by, and inactive models left out', async (provider, url) => {
      const calls = stubUpstream(() =>
        json({
          data: [
            { id: 'a', owned_by: 'Meta' },
            { id: 'b', active: false },
            { id: 'c', active: true },
          ],
        })
      );

      const { status, body } = await listModels(provider, { 'X-Api-Key': 'key-1' });

      expect(status).toBe(200);
      expect(body).toEqual({
        provider,
        models: [{ id: 'a', ownedBy: 'Meta' }, { id: 'c' }],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(url);
      expect(calls[0].headers).toEqual({ Authorization: 'Bearer key-1' });
    });

    it('still gives 401 with no key and 400 for an unknown provider', async () => {
      stubUpstream(() => json({ data: [] }));

      expect((await listModels('groq')).status).toBe(401);
      expect((await listModels('openai', { 'X-Api-Key': 'k' })).status).toBe(400);
      expect((await listModels(null, { 'X-Api-Key': 'k' })).status).toBe(400);
    });
  });
});
