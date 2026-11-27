// @vitest-environment node
import { type IncomingMessage, type Server, createServer, request } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { endStreamWithError, limitStreamedBody } from '../security';

/** Run a handler in a real HTTP server and return the response */
async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return { status: response.status, body: await response.text() };
  } finally {
    server.close();
  }
}

describe('endStreamWithError', () => {
  it('writes the error as an SSE event when the stream has started', async () => {
    let handled: boolean | undefined;
    const { status, body } = await serve((_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('data: {"content":"Hel"}\n\n');
      handled = endStreamWithError(res, 'Model failed');
    });
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(body).toBe(
      'data: {"content":"Hel"}\n\ndata: {"error":"Model failed"}\n\ndata: [DONE]\n\n'
    );
  });

  it('cuts a long error to 500 characters', async () => {
    const { body } = await serve((_req, res) => {
      res.write('data: {"content":"Hel"}\n\n');
      endStreamWithError(res, 'e'.repeat(5000));
    });
    const event = body.split('\n\n').find((line) => line.includes('"error"'));
    const { error } = JSON.parse(event!.slice('data: '.length)) as { error: string };
    expect(error).toBe('e'.repeat(500));
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('does nothing before the response starts, so the caller can send a status', async () => {
    let handled: boolean | undefined;
    const { status } = await serve((_req, res) => {
      handled = endStreamWithError(res, 'Model failed');
      res.statusCode = 500;
      res.end('{}');
    });
    expect(handled).toBe(false);
    expect(status).toBe(500);
  });
});

// ─── limitStreamedBody, modelled on http-proxy-3: the `start` hook, then req.pipe(proxyReq) ──

const LIMIT = 1024;

interface UpstreamRequest {
  method: string;
  bytes: number;
  ended: boolean;
  closed: boolean;
}

interface Answer {
  status: number;
  body: string;
}

describe('limitStreamedBody', () => {
  let upstream: Server;
  let front: Server;
  let seen: UpstreamRequest[] = [];

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      const record: UpstreamRequest = {
        method: req.method ?? '',
        bytes: 0,
        ended: false,
        closed: false,
      };
      seen.push(record);
      req.on('data', (chunk: Buffer) => (record.bytes += chunk.length));
      req.on('close', () => (record.closed = true));
      req.on('end', () => {
        record.ended = true;
        // A streamed answer in three parts
        res.write('one ');
        setTimeout(() => res.write('two '), 20);
        setTimeout(() => res.end(`three ${record.bytes}`), 40);
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    front = createServer((req, res) => {
      limitStreamedBody(req, res, LIMIT); // the `start` event
      const proxyReq = request({
        host: '127.0.0.1',
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      });
      // As http-proxy-3 does (vite/dist/node/chunks/node.js, `stream`)
      res.on('close', () => {
        if (!res.writableFinished) proxyReq.destroy();
      });
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (req.socket.destroyed && error.code === 'ECONNRESET') proxyReq.destroy();
      });
      proxyReq.on('error', () => undefined);
      proxyReq.on('response', (proxyRes) => {
        if (res.headersSent) return;
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      req.pipe(proxyReq);
    });
    await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    front.closeAllConnections();
    upstream.closeAllConnections();
    await new Promise((resolve) => front.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  });

  beforeEach(() => {
    seen = [];
  });

  /** Send a request; `chunks` are written one by one with no Content-Length (chunked) */
  function send(method: string, options: { body?: string; chunks?: string[] } = {}) {
    return new Promise<Answer>((resolve) => {
      const headers: Record<string, string | number> = { 'content-type': 'application/json' };
      if (options.body !== undefined) headers['content-length'] = Buffer.byteLength(options.body);
      const req = request(
        {
          host: '127.0.0.1',
          port: (front.address() as AddressInfo).port,
          method,
          path: '/x',
          headers,
        },
        (res: IncomingMessage) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          res.on('error', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      // Writes after the refusal can fail; the answer has already arrived
      req.on('error', () => undefined);
      if (options.chunks) {
        for (const chunk of options.chunks) req.write(chunk);
        req.end();
      } else {
        req.end(options.body);
      }
    });
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('forwards a body under the limit', async () => {
    const answer = await send('POST', { body: 'a'.repeat(500) });
    expect(answer).toEqual({ status: 200, body: 'one two three 500' });
  });

  it('forwards a GET with no body and streams the answer', async () => {
    const answer = await send('GET');
    expect(answer).toEqual({ status: 200, body: 'one two three 0' });
    expect(seen.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses a declared Content-Length over the limit before the upstream gets a byte', async () => {
    const answer = await send('POST', { body: 'a'.repeat(5000) });
    await settle();
    expect(answer.status).toBe(413);
    expect(JSON.parse(answer.body)).toEqual({ error: 'Request body too large' });
    expect(seen.every((r) => r.bytes === 0 && !r.ended && r.closed)).toBe(true);
  });

  it('refuses a chunked body at the limit and ends the upstream request', async () => {
    const answer = await send('POST', {
      chunks: Array.from({ length: 20 }, () => 'b'.repeat(500)),
    });
    await settle();
    expect(answer.status).toBe(413);
    // The chunk that crosses the limit goes through too (see limitStreamedBody)
    expect(seen.every((r) => r.bytes <= LIMIT + 64 * 1024 && !r.ended)).toBe(true);
    expect(seen.every((r) => r.closed)).toBe(true);
  });

  it('counts bytes, not characters', async () => {
    // 400 euro signs: 400 characters, 1,200 bytes
    const answer = await send('POST', { chunks: ['€'.repeat(200), '€'.repeat(200)] });
    expect(answer.status).toBe(413);
  });
});
