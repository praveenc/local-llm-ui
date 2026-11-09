// @vitest-environment node
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';

import { endStreamWithError } from '../security';

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
    expect(body).toBe('data: {"content":"Hel"}\n\ndata: {"error":"Model failed"}\n\ndata: [DONE]\n\n');
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
