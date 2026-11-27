// @vitest-environment node
import { createServer, get as httpGet } from 'http';
import type { IncomingHttpHeaders } from 'http';
import type { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';

import {
  MAX_ERROR_LENGTH,
  abortOnClose,
  capErrorText,
  isAbortAfterClientLeft,
  readChatRequest,
  sendJsonError,
  startEventStream,
} from '../security';
import type { ChatRequest } from '../security';
import { BAD_BODIES } from './fixtures/chat-proxy-harness';

/** Run readChatRequest on one body. Returns the status, the JSON body, and the parsed request */
async function read(body: string, maxSize?: number) {
  let request: ChatRequest | null | undefined;
  const server = createServer((req, res) => {
    void readChatRequest(req, res, { maxSize }).then((value) => {
      request = value;
      if (value) res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await response.text();
    return { status: response.status, text, request };
  } finally {
    server.close();
  }
}

const hi = { role: 'user', content: 'Hi' };

describe('readChatRequest', () => {
  it.each(BAD_BODIES)('answers 400 JSON for %s', async (_name, body) => {
    const { status, text, request } = await read(body);
    expect(status).toBe(400);
    expect(typeof (JSON.parse(text) as { error: unknown }).error).toBe('string');
    expect(request).toBeNull();
  });

  it.each([
    ['invalid JSON', '{', 'Invalid JSON body'],
    [
      'a tool message',
      '{"model":"m","messages":[{"role":"tool","content":"x"}]}',
      'Invalid messages array',
    ],
    [
      'only empty messages',
      '{"model":"m","messages":[{"role":"user","content":" "}]}',
      'At least one non-empty message is required',
    ],
  ])('names the problem for %s', async (_name, body, error) => {
    expect(JSON.parse((await read(body)).text)).toEqual({ error });
  });

  it('takes the bodies that the browser sends', async () => {
    // As useBedrockChat.ts builds them: files on every message, thinking effort, tool steps
    const body = {
      model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      messages: [
        { role: 'system', content: 'Be brief', files: [] },
        { role: 'user', content: 'Hi', files: [{ name: 'a.pdf', format: 'pdf', bytes: 'AA==' }] },
        { role: 'assistant', content: 'Hello', files: [] },
      ],
      max_tokens: 4096,
      maxToolSteps: 10,
      enableWebSearch: false,
      thinkingEffort: 'high',
      mcpServers: [{ id: 'x', name: 'x', type: 'stdio', command: 'npx', enabled: true }],
      provider: 'groq',
    };
    const { status, request } = await read(JSON.stringify(body));
    expect(status).toBe(200);
    expect(request).toEqual(body);
  });

  it.each([
    // An LM Studio model id is a file path
    'lmstudio-community/Qwen3 8B (Q4_K_M)+x/model.gguf',
    'qwen3:8b',
    'm'.repeat(256),
    'modèle-ü',
  ])('takes the model id %s', async (model) => {
    expect((await read(JSON.stringify({ model, messages: [hi] }))).status).toBe(200);
  });

  it('leaves out messages with no text and no files, and keeps the rest in order', async () => {
    const { request } = await read(
      JSON.stringify({
        model: 'm',
        messages: [
          { role: 'user', content: '  ' },
          { role: 'user', content: '', files: [{ name: 'a', format: 'png', bytes: '' }] },
          hi,
        ],
      })
    );
    expect(request?.messages).toEqual([
      { role: 'user', content: '', files: [{ name: 'a', format: 'png', bytes: '' }] },
      hi,
    ]);
  });

  it('counts the body limit in bytes', async () => {
    // 400 euro signs: 400 characters, 1,200 bytes
    const body = JSON.stringify({
      model: 'm',
      messages: [{ role: 'user', content: '€'.repeat(400) }],
    });
    expect(body.length).toBeLessThan(1024);
    const { status, text } = await read(body, 1024);
    expect(status).toBe(413);
    expect(JSON.parse(text)).toEqual({ error: 'Request body too large' });
  });

  it('keeps a character that is split across two chunks', async () => {
    const content = '€'.repeat(50_000);
    const { request } = await read(
      JSON.stringify({ model: 'm', messages: [{ role: 'user', content }] })
    );
    expect(request?.messages[0].content).toBe(content);
  });
});

describe('capErrorText and sendJsonError', () => {
  it('cuts a long text to 500 characters and leaves a short one', () => {
    expect(capErrorText('x'.repeat(5000))).toHaveLength(MAX_ERROR_LENGTH);
    expect(capErrorText('short')).toBe('short');
  });

  it('does not leave half of a character at the cut', () => {
    const text = `${'x'.repeat(MAX_ERROR_LENGTH - 1)}😀tail`;
    expect(capErrorText(text)).toBe('x'.repeat(MAX_ERROR_LENGTH - 1));
  });

  it('sends a capped JSON error', async () => {
    const server = createServer((_req, res) => sendJsonError(res, 502, 'e'.repeat(5000)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(((await response.json()) as { error: string }).error).toHaveLength(500);
    } finally {
      server.close();
    }
  });
});

describe('sendJsonError after startEventStream', () => {
  it('removes the SSE headers when no byte went out', async () => {
    const server = createServer((_req, res) => {
      startEventStream(res);
      sendJsonError(res, 500, 'The model call failed');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      // A raw request: fetch hides the connection header
      const { port } = server.address() as AddressInfo;
      const reply = await new Promise<{
        status?: number;
        headers: IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        httpGet({ host: '127.0.0.1', port, agent: false }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on('error', reject);
      });
      expect(reply.status).toBe(500);
      expect(reply.headers['content-type']).toBe('application/json');
      expect(reply.headers['cache-control']).toBeUndefined();
      expect(reply.headers.connection).not.toBe('keep-alive');
      expect(JSON.parse(reply.body)).toEqual({ error: 'The model call failed' });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('isAbortAfterClientLeft', () => {
  const abortError = new DOMException('This operation was aborted', 'AbortError');
  const gone = { destroyed: true } as unknown as Parameters<typeof isAbortAfterClientLeft>[1];
  const here = { destroyed: false } as unknown as Parameters<typeof isAbortAfterClientLeft>[1];

  it('is true only for an AbortError after the connection closed', () => {
    expect(isAbortAfterClientLeft(abortError, gone)).toBe(true);
    expect(isAbortAfterClientLeft(abortError, here)).toBe(false);
    expect(isAbortAfterClientLeft(new Error('socket hang up'), gone)).toBe(false);
    expect(isAbortAfterClientLeft('AbortError', gone)).toBe(false);
  });
});

describe('startEventStream', () => {
  it('sets the SSE headers', async () => {
    const server = createServer((_req, res) => {
      startEventStream(res);
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      await response.text();
    } finally {
      server.close();
    }
  });
});

describe('abortOnClose', () => {
  /** Start a request whose handler reads the body, gets the signal, and writes one chunk */
  async function run(clientLeaves: boolean) {
    let signal: AbortSignal | undefined;
    const server = createServer(async (req, res) => {
      for await (const chunk of req) void chunk;
      signal = abortOnClose(res);
      res.write('data: x\n\n');
      if (!clientLeaves) res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      });
      await response.body?.getReader().read();
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (clientLeaves) controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return signal;
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  it('aborts when the client leaves after the body was read', async () => {
    expect((await run(true))?.aborted).toBe(true);
  });

  it('does not abort after the response ended', async () => {
    expect((await run(false))?.aborted).toBe(false);
  });

  it('aborts at once when the connection is already closed', async () => {
    let signal: AbortSignal | undefined;
    const server = createServer((_req, res) => {
      res.on('close', () => {
        signal = abortOnClose(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    const request = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 150));
    server.closeAllConnections();
    server.close();
    expect(signal?.aborted).toBe(true);
  });
});
