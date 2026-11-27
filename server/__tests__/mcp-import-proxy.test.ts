// @vitest-environment node
import { createServer, request } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MCP_IMPORT_READ_BODY_LIMIT,
  MCP_IMPORT_SCAN_BODY_LIMIT,
  createMCPImportProxy,
} from '../mcp-import-proxy.ts';
import type { MCPImporter } from '../mcp-import.ts';

// A fake importer: the routes never read a file in these tests
const calls: string[][] = [];
const importer: MCPImporter = {
  scan: async () => ({ files: [] }),
  read: async (keys) => {
    calls.push([...keys]);
    return { servers: [], skipped: [] };
  },
};

let server: Server;
let port: number;

beforeAll(async () => {
  const proxy = createMCPImportProxy({ importer });
  server = createServer((req, res) => {
    void proxy(req, res, () => {
      res.statusCode = 299;
      res.end('next');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls.length = 0;
});

function send(
  method: string,
  path: string,
  body?: string
): Promise<{ status: number; body: string; allow?: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: text,
            allow: res.headers.allow as string | undefined,
          })
        );
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('MCP import routes', () => {
  it('answers 405 for a GET', async () => {
    for (const path of ['/api/mcp/import/scan', '/api/mcp/import/read']) {
      const reply = await send('GET', path);
      expect([reply.status, reply.allow]).toEqual([405, 'POST']);
    }
  });

  it('leaves other paths to the next middleware', async () => {
    expect((await send('GET', '/api/mcpx')).status).toBe(299);
    expect((await send('GET', '/api/kiro/status')).status).toBe(299);
    expect((await send('POST', '/api/mcp/other', '{}')).status).toBe(404);
  });

  it('scans with an empty JSON body', async () => {
    const reply = await send('POST', '/api/mcp/import/scan', '{}');
    expect([reply.status, JSON.parse(reply.body)]).toEqual([200, { files: [] }]);
  });

  it('answers 413 over the body limits', async () => {
    const big = (n: number) => JSON.stringify({ pad: 'x'.repeat(n) });
    expect(
      (await send('POST', '/api/mcp/import/scan', big(MCP_IMPORT_SCAN_BODY_LIMIT))).status
    ).toBe(413);
    expect(
      (await send('POST', '/api/mcp/import/read', big(MCP_IMPORT_READ_BODY_LIMIT))).status
    ).toBe(413);
    expect(calls).toEqual([]);
  });

  it.each([
    ['not JSON', 'x'],
    ['no keys', '{}'],
    ['an empty list', '{"keys":[]}'],
    ['a key that is not text', '{"keys":[1]}'],
    ['an empty key', '{"keys":[""]}'],
    ['a key over 300 characters', JSON.stringify({ keys: ['k'.repeat(301)] })],
    ['over 100 keys', JSON.stringify({ keys: Array.from({ length: 101 }, (_, i) => `k${i}`) })],
    ['an array body', '["a"]'],
  ])('answers 400 for %s', async (_, body) => {
    const reply = await send('POST', '/api/mcp/import/read', body);
    expect(reply.status).toBe(400);
    expect(Object.keys(JSON.parse(reply.body))).toEqual(['error']);
    expect(calls).toEqual([]);
  });

  it('passes good keys to the importer', async () => {
    const reply = await send(
      'POST',
      '/api/mcp/import/read',
      JSON.stringify({ keys: ['kiro:0:a'] })
    );
    expect(reply.status).toBe(200);
    expect(calls).toEqual([['kiro:0:a']]);
  });
});
