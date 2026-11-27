// @vitest-environment node
import { type ChildProcess, spawn } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { type IncomingMessage, type Server, createServer, request } from 'http';
import { type AddressInfo, connect } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkApiRequest, isApiPath } from '../security';

// Vite cannot start inside the Vitest VM pool, so the real servers run in a child process
const VITE_FIXTURE = fileURLToPath(new URL('./fixtures/api-guard-vite.mjs', import.meta.url));

type Headers = Record<string, string>;

function fakeRequest(method: string, headers: Headers): IncomingMessage {
  return { method, url: '/api/x', headers } as unknown as IncomingMessage;
}

const JSON_TYPE = { 'content-type': 'application/json' };

describe('isApiPath', () => {
  it.each([
    ['/api', true],
    ['/api/', true],
    ['/api/bedrock-aisdk/chat', true],
    ['/api?x=1', true],
    ['/API/x', true],
    ['/./api/x', true],
    ['/a/../api/x', true],
    ['//api/x', true],
    ['http://localhost:5173/api/x', true],
    ['/apiary', false],
    ['/src/api/x.ts', false],
    ['/%61pi/x', false],
    ['/', false],
    [undefined, false],
  ])('%s → %s', (url, expected) => {
    expect(isApiPath(url)).toBe(expected);
  });
});

describe('checkApiRequest', () => {
  it.each<[string, string, Headers]>([
    ['a same-origin JSON POST', 'POST', { 'sec-fetch-site': 'same-origin', ...JSON_TYPE }],
    [
      'JSON with a charset',
      'POST',
      { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' },
    ],
    ['a typed URL', 'GET', { 'sec-fetch-site': 'none' }],
    ['curl, with no browser headers', 'POST', JSON_TYPE],
    ['a GET with no headers', 'GET', {}],
    [
      'an Origin that matches Host',
      'POST',
      { origin: 'http://localhost:5173', host: 'localhost:5173', ...JSON_TYPE },
    ],
    [
      'an https Origin that matches X-Forwarded-Host (tunnel)',
      'POST',
      {
        origin: 'https://me-app.w.tunnels.example',
        host: 'localhost:5173',
        'x-forwarded-host': 'me-app.w.tunnels.example',
        ...JSON_TYPE,
      },
    ],
    [
      'X-Forwarded-Host with the default port',
      'POST',
      {
        origin: 'https://app.example',
        host: 'localhost:5173',
        'x-forwarded-host': 'app.example:443',
        ...JSON_TYPE,
      },
    ],
    [
      'a host in upper case',
      'POST',
      { origin: 'http://LOCALHOST:5173', host: 'localhost:5173', ...JSON_TYPE },
    ],
  ])('allows %s', (_name, method, headers) => {
    expect(checkApiRequest(fakeRequest(method, headers))).toBeNull();
  });

  it.each<[string, string, Headers, number]>([
    ['a cross-site POST', 'POST', { 'sec-fetch-site': 'cross-site', ...JSON_TYPE }, 403],
    ['a cross-site GET', 'GET', { 'sec-fetch-site': 'cross-site' }, 403],
    [
      'another app on localhost (same-site)',
      'POST',
      { 'sec-fetch-site': 'same-site', ...JSON_TYPE },
      403,
    ],
    [
      'cross-site even when Origin matches Host',
      'POST',
      {
        'sec-fetch-site': 'cross-site',
        origin: 'http://localhost:5173',
        host: 'localhost:5173',
        ...JSON_TYPE,
      },
      403,
    ],
    [
      'an Origin from another site',
      'POST',
      { origin: 'https://evil.example', host: 'localhost:5173', ...JSON_TYPE },
      403,
    ],
    [
      'another port on localhost',
      'POST',
      { origin: 'http://localhost:3000', host: 'localhost:5173', ...JSON_TYPE },
      403,
    ],
    [
      'an http Origin that matches only a forged X-Forwarded-Host',
      'POST',
      {
        origin: 'http://localhost:3000',
        host: 'localhost:5173',
        'x-forwarded-host': 'localhost:3000',
        ...JSON_TYPE,
      },
      403,
    ],
    [
      'Origin "null" (sandboxed frame)',
      'POST',
      { origin: 'null', host: 'localhost:5173', ...JSON_TYPE },
      403,
    ],
    [
      'an Origin that is not http',
      'POST',
      { origin: 'file://x', host: 'localhost:5173', ...JSON_TYPE },
      403,
    ],
    [
      'a text/plain POST from the app',
      'POST',
      { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
      415,
    ],
    [
      'a form POST with no browser headers',
      'POST',
      { 'content-type': 'application/x-www-form-urlencoded' },
      415,
    ],
    ['a POST with no Content-Type', 'POST', { 'sec-fetch-site': 'same-origin' }, 415],
    ['a DELETE with no Content-Type', 'DELETE', {}, 415],
  ])('rejects %s', (_name, method, headers, status) => {
    expect(checkApiRequest(fakeRequest(method, headers))?.status).toBe(status);
  });
});

// ─── Real Vite servers ───────────────────────────────────────────────────────

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
  port: number,
  method: string,
  path: string,
  headers: Headers,
  body = ''
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data })
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Send a request line as written, for targets that http.request would not send as they are */
function sendRaw(port: number, target: string, headers: Headers, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const lines = [
      `POST ${target} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Connection: close',
      `Content-Length: ${Buffer.byteLength(body)}`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    ];
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => resolve(Number(data.split(' ')[1])));
    socket.on('error', reject);
    socket.write(`${lines.join('\r\n')}\r\n\r\n${body}`);
  });
}

const CROSS_SITE_FORM = {
  origin: 'https://evil.example',
  'sec-fetch-site': 'cross-site',
  'content-type': 'text/plain',
};
const SAME_ORIGIN_JSON = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

interface Ready {
  dev: number;
  preview: number;
  app: number;
  order: string[];
}

describe('the guard on real Vite servers', () => {
  let upstream: Server;
  let upstreamHits: string[] = [];
  let child: ChildProcess;
  let ready: Ready;
  let root: string;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      upstreamHits.push(`${req.method} ${req.url}`);
      if (req.url === '/api/stream') {
        // A streamed answer in three parts, as Ollama streams /api/pull
        res.write('one ');
        setTimeout(() => res.write('two '), 30);
        setTimeout(() => res.end('three'), 60);
        return;
      }
      res.end('upstream');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));

    root = mkdtempSync(join(tmpdir(), 'api-guard-'));
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><p>app</p>');

    child = spawn(process.execPath, [VITE_FIXTURE], {
      env: {
        ...process.env,
        API_GUARD_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
        API_GUARD_ROOT: root,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    ready = await new Promise<Ready>((resolve, reject) => {
      let stdout = '';
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
        const line = stdout.split('\n').find((text) => text.startsWith('API_GUARD_READY '));
        if (!line) return;
        try {
          resolve(JSON.parse(line.slice('API_GUARD_READY '.length)));
        } catch (error) {
          reject(error);
        }
      });
      child.on('exit', (code) => reject(new Error(`Vite fixture exited ${code}: ${stderr}`)));
    });
  }, 60_000);

  beforeEach(() => {
    upstreamHits = [];
  });

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.on('exit', resolve));
      child.stdin?.end();
      await exited;
    }
    await new Promise<void>((resolve) => (upstream ? upstream.close(() => resolve()) : resolve()));
    if (root) rmSync(root, { recursive: true, force: true });
  }, 15_000);

  describe('dev server', () => {
    it('blocks a cross-site form post before server.proxy forwards it', async () => {
      const reply = await send(ready.dev, 'POST', '/api/upstream/api/pull', CROSS_SITE_FORM, 'x');
      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.body)).toEqual({ error: 'Cross-site request blocked' });
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(upstreamHits).toEqual([]);
    });

    it('blocks a cross-site post before the plugin proxies', async () => {
      const reply = await send(ready.dev, 'POST', '/api/plugin/chat', CROSS_SITE_FORM, 'x');
      expect(reply.status).toBe(403);
    });

    it.each(['/./api/plugin/chat', '/x/../api/plugin/chat', 'http://localhost/api/plugin/chat'])(
      'blocks %s, which a router that parses the URL takes for /api',
      async (target) => {
        expect(await sendRaw(ready.dev, target, CROSS_SITE_FORM, 'x')).toBe(403);
      }
    );

    it('blocks an old browser on another localhost port that forges X-Forwarded-Host', async () => {
      const reply = await send(
        ready.dev,
        'POST',
        '/api/upstream/api/pull',
        { origin: 'http://localhost:3000', 'x-forwarded-host': 'localhost:3000', ...JSON_TYPE },
        '{}'
      );
      expect(reply.status).toBe(403);
      expect(upstreamHits).toEqual([]);
    });

    it('fails the preflight of another localhost port', async () => {
      const reply = await send(ready.dev, 'OPTIONS', '/api/upstream/api/pull', {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-forwarded-host',
      });
      expect(reply.status).toBe(403);
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('lets the app reach both kinds of route', async () => {
      const plugin = await send(ready.dev, 'POST', '/api/plugin/chat', SAME_ORIGIN_JSON, '{}');
      expect([plugin.status, plugin.body]).toEqual([200, 'plugin']);
      const proxied = await send(ready.dev, 'GET', '/api/upstream/api/tags', {
        'sec-fetch-site': 'same-origin',
      });
      expect([proxied.status, proxied.body]).toEqual([200, 'upstream']);
      expect(upstreamHits).toEqual(['GET /api/tags']);
    });

    it('does not touch pages outside /api', async () => {
      const reply = await send(ready.dev, 'GET', '/', { 'sec-fetch-site': 'cross-site' });
      expect(reply.status).not.toBe(403);
    });
  });

  describe('preview server', () => {
    it('blocks a cross-site post before preview.proxy', async () => {
      const reply = await send(
        ready.preview,
        'POST',
        '/api/upstream/api/pull',
        CROSS_SITE_FORM,
        'x'
      );
      expect(reply.status).toBe(403);
      expect(upstreamHits).toEqual([]);
    });
  });

  describe("the app's vite.config.ts", () => {
    it('runs the guard before every other configureServer middleware', () => {
      expect(ready.order[0]).toBe('api-guard');
    });

    it.each(['/api/bedrock-aisdk/mcp-status', '/api/ollama/api/pull'])(
      'blocks a cross-site form post to %s',
      async (path) => {
        expect((await send(ready.app, 'POST', path, CROSS_SITE_FORM, '{}')).status).toBe(403);
      }
    );

    it('refuses a body over 16 KB to the plain Ollama proxy with 413', async () => {
      const reply = await send(
        ready.app,
        'POST',
        '/api/ollama/api/pull',
        SAME_ORIGIN_JSON,
        JSON.stringify({ name: 'x'.repeat(17 * 1024) })
      );
      expect(reply.status).toBe(413);
      expect(JSON.parse(reply.body)).toEqual({ error: 'Request body too large' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(upstreamHits).toEqual([]);
    });

    it('still forwards a small body to the plain Ollama proxy', async () => {
      const reply = await send(
        ready.app,
        'POST',
        '/api/ollama/api/show',
        SAME_ORIGIN_JSON,
        '{"model":"m"}'
      );
      expect([reply.status, reply.body]).toEqual([200, 'upstream']);
      expect(upstreamHits).toEqual(['POST /api/show']);
    });

    it('still proxies a GET to the plain Ollama proxy and streams the answer', async () => {
      const reply = await send(ready.app, 'GET', '/api/ollama/api/stream', {
        'sec-fetch-site': 'same-origin',
      });
      expect([reply.status, reply.body]).toEqual([200, 'one two three']);
      expect(upstreamHits).toEqual(['GET /api/stream']);
    });

    it('rejects a text/plain post from the app with 415', async () => {
      const reply = await send(
        ready.app,
        'POST',
        '/api/bedrock-aisdk/mcp-status',
        { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        '{}'
      );
      expect(reply.status).toBe(415);
    });

    it('passes a same-origin JSON post on to the proxy', async () => {
      // The Anthropic proxy answers 400 for a body that is not JSON, before it needs a key
      const reply = await send(ready.app, 'POST', '/api/anthropic/chat', SAME_ORIGIN_JSON, 'x');
      expect([reply.status, JSON.parse(reply.body)]).toEqual([400, { error: 'Invalid JSON body' }]);
    });

    it('has no CORS answer for another localhost port', async () => {
      const reply = await send(ready.app, 'OPTIONS', '/api/anthropic/chat', {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      });
      expect(reply.status).toBe(403);
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
