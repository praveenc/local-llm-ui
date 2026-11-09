// @vitest-environment node
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleMantleRequest } from '../mantle-proxy';

describe('Mantle proxy errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports an upstream stream failure in SSE format and does not throw', async () => {
    const realFetch = globalThis.fetch;
    // Upstream sends one chunk, then the connection fails on the next read
    let reads = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
          );
        } else {
          controller.error(new Error('socket hang up'));
        }
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
        String(input).includes('127.0.0.1')
          ? realFetch(input, init)
          : new Response(upstream, { status: 200 })
      )
    );

    let handled: Promise<void> | undefined;
    const server = createServer((req, res) => {
      handled = handleMantleRequest(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await realFetch(`http://127.0.0.1:${port}/api/mantle/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mantle-Api-Key': 'test-key',
          'X-Mantle-Region': 'us-west-2',
        },
        body: JSON.stringify({ model: 'openai.gpt-oss-120b', messages: [{ role: 'user', content: 'Hi' }] }),
      });
      const body = await response.text();

      await expect(handled).resolves.toBeUndefined();
      expect(response.status).toBe(200);
      expect(body).toContain('"content":"Hi"');
      expect(body).toContain('socket hang up');
      expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
    } finally {
      server.close();
    }
  });
});
