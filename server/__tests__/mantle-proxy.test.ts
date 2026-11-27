// @vitest-environment node
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleMantleRequest } from '../mantle-proxy';
import * as harness from './fixtures/chat-proxy-harness';

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
        body: JSON.stringify({
          model: 'openai.gpt-oss-120b',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
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

const MANTLE_HEADERS = { 'X-Mantle-Api-Key': 'test-key', 'X-Mantle-Region': 'us-west-2' };
const MANTLE_BODY = {
  model: 'openai.gpt-oss-120b',
  messages: [{ role: 'user', content: 'Hi', files: [] }],
  max_tokens: 4096,
  maxToolSteps: 10,
  enableWebSearch: false,
};

/** Stub the upstream fetch with the given stream; records the init of the upstream call */
function stubUpstream(upstream: ReadableStream<Uint8Array> | (() => Response)) {
  const realFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('127.0.0.1')) return realFetch(input, init);
      calls.push(init ?? {});
      return typeof upstream === 'function' ? upstream() : new Response(upstream, { status: 200 });
    })
  );
  return calls;
}

describe('Mantle chat proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes [DONE] once when the upstream sends its own [DONE]', async () => {
    const encoder = new TextEncoder();
    stubUpstream(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      })
    );
    const reply = await harness.post(
      handleMantleRequest,
      '/api/mantle/chat',
      MANTLE_BODY,
      MANTLE_HEADERS
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('"content":"Hi"');
    expect(reply.body.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(reply.body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('does not echo an invalid region header', async () => {
    const calls = stubUpstream(() => new Response('{}'));
    const region = `x-${'r'.repeat(5000)}`;
    const reply = await harness.post(
      handleMantleRequest,
      '/api/mantle/chat',
      { model: 'm', messages: [{ role: 'user', content: 'Hi' }] },
      { ...MANTLE_HEADERS, 'X-Mantle-Region': region }
    );
    expect(reply.status).toBe(400);
    const json = JSON.parse(reply.body) as { error: string };
    expect(json.error).toBe('Invalid region');
    expect(reply.body).not.toContain('rrrr');
    expect(calls).toHaveLength(0);
  });

  it.each(harness.BAD_BODIES)('answers 400 JSON for %s', async (_name, bad) => {
    const calls = stubUpstream(() => new Response('{}'));
    const reply = await harness.post(handleMantleRequest, '/api/mantle/chat', bad, MANTLE_HEADERS);
    expect(reply.status).toBe(400);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(calls).toHaveLength(0);
  });

  it('passes a signal to the upstream fetch that aborts when the browser leaves', async () => {
    let cancelled = false;
    let pulls = 0;
    const calls = stubUpstream(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          pulls += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n')
          );
        },
        cancel() {
          cancelled = true;
        },
      })
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await harness.postAndLeave(
        handleMantleRequest,
        '/api/mantle/chat',
        MANTLE_BODY,
        MANTLE_HEADERS
      );
      expect(calls[0].signal?.aborted).toBe(true);
      expect(cancelled).toBe(true);
      const pullsAfter = pulls;
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(pulls).toBe(pullsAfter);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('cuts a 5,000-character upstream error to 500 characters', async () => {
    stubUpstream(() => new Response('e'.repeat(5000), { status: 400 }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const reply = await harness.post(
        handleMantleRequest,
        '/api/mantle/chat',
        MANTLE_BODY,
        MANTLE_HEADERS
      );
      expect(reply.status).toBe(500);
      const { errorDetail } = JSON.parse(reply.body) as { errorDetail: string };
      expect(errorDetail.length).toBe(500);
    } finally {
      errors.mockRestore();
    }
  });

  it('cuts a 5,000-character stream error to 500 characters', async () => {
    let reads = 0;
    stubUpstream(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          reads += 1;
          if (reads === 1) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
            );
          } else {
            controller.error(new Error('e'.repeat(5000)));
          }
        },
      })
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const reply = await harness.post(
        handleMantleRequest,
        '/api/mantle/chat',
        MANTLE_BODY,
        MANTLE_HEADERS
      );
      const events = harness.events(reply.body).filter((p) => 'error' in p);
      expect(events).toHaveLength(1);
      expect((events[0].error as string).length).toBe(500);
    } finally {
      errors.mockRestore();
    }
  });
});
