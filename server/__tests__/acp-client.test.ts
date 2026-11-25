// @vitest-environment node
import { spawn } from 'child_process';
import path from 'path';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { AcpClosedError, AcpConnection, AcpError, AcpTimeoutError } from '../acp/client.ts';
import { stopProcessTree } from '../acp/process.ts';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-kiro-acp.mjs'
);

function pair(maxLineBytes?: number) {
  const fromAgent = new PassThrough();
  const toAgent = new PassThrough();
  const conn = new AcpConnection(fromAgent, toAgent, { maxLineBytes });
  const sent: Record<string, unknown>[] = [];
  let rest = '';
  toAgent.on('data', (chunk: Buffer) => {
    rest += chunk.toString();
    let i;
    while ((i = rest.indexOf('\n')) >= 0) {
      sent.push(JSON.parse(rest.slice(0, i)) as Record<string, unknown>);
      rest = rest.slice(i + 1);
    }
  });
  return { conn, fromAgent, toAgent, sent };
}

const tick = () => new Promise((r) => setImmediate(r));
const line = (msg: object) => `${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`;

describe('AcpConnection framing', () => {
  it('joins a message split over chunks and splits chunks with several messages', async () => {
    const { conn, fromAgent } = pair();
    const notes: unknown[] = [];
    conn.onNotification((method, params) => notes.push([method, params]));
    const a = conn.request<{ x: number }>('a', {});
    const b = conn.request<{ x: number }>('b', {});
    const text = line({ id: 1, result: { x: 1 } }) + line({ method: 'n', params: { é: 'ü' } });
    const bytes = Buffer.from(text);
    // Split inside a multi-byte character, then send the rest with a second message
    fromAgent.write(bytes.subarray(0, 5));
    fromAgent.write(bytes.subarray(5, bytes.length - 4));
    fromAgent.write(
      Buffer.concat([
        bytes.subarray(bytes.length - 4),
        Buffer.from(line({ id: 2, result: { x: 2 } })),
      ])
    );
    expect(await a).toEqual({ x: 1 });
    expect(await b).toEqual({ x: 2 });
    expect(notes).toEqual([['n', { é: 'ü' }]]);
  });

  it('ignores lines that are not JSON and counts them', async () => {
    const { conn, fromAgent } = pair();
    const p = conn.request('a', {});
    fromAgent.write('Cannot open directory\n[1,2]\n\n' + line({ id: 1, result: 'ok' }));
    expect(await p).toBe('ok');
    expect(conn.ignoredLines).toBe(2);
    expect(conn.closed).toBe(false);
  });

  it('closes when one line is larger than the limit', async () => {
    const { conn, fromAgent } = pair(100);
    const p = conn.request('a', {});
    fromAgent.write('x'.repeat(60));
    fromAgent.write('x'.repeat(60));
    await expect(p).rejects.toBeInstanceOf(AcpClosedError);
    expect(conn.closed).toBe(true);
  });
});

describe('AcpConnection requests', () => {
  it('rejects with AcpError on an error answer', async () => {
    const { conn, fromAgent } = pair();
    const p = conn.request('session/new', {});
    fromAgent.write(
      line({ id: 1, error: { code: -32000, message: 'Authentication required', data: { a: 1 } } })
    );
    const error = await p.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AcpError);
    expect(error).toMatchObject({
      code: -32000,
      message: 'Authentication required',
      data: { a: 1 },
    });
  });

  it('times out a request and keeps the connection open', async () => {
    const { conn, fromAgent, sent } = pair();
    await expect(conn.request('slow', {}, { timeoutMs: 20 })).rejects.toBeInstanceOf(
      AcpTimeoutError
    );
    expect(conn.closed).toBe(false);
    // The late answer is dropped, the next request works
    fromAgent.write(line({ id: 1, result: 'late' }));
    const next = conn.request('next', {});
    fromAgent.write(line({ id: 2, result: 'ok' }));
    expect(await next).toBe('ok');
    expect(sent.map((m) => m.method)).toEqual(['slow', 'next']);
  });

  it('answers -32601 at once to an agent request that it does not know', async () => {
    const { conn, fromAgent, sent } = pair();
    conn.onRequest((method) => (method === 'known' ? Promise.resolve({ ok: true }) : undefined));
    fromAgent.write(line({ id: 7, method: 'fs/read_text_file', params: {} }));
    fromAgent.write(line({ id: 'x', method: 'known', params: {} }));
    await tick();
    await tick();
    expect(sent).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32601, message: 'Method not found: fs/read_text_file' },
      },
      { jsonrpc: '2.0', id: 'x', result: { ok: true } },
    ]);
  });

  it('ignores an agent request whose id is not a string or a number', async () => {
    const { conn, fromAgent, sent } = pair();
    conn.onRequest(() => Promise.resolve({ ok: true }));
    fromAgent.write(line({ id: { a: 1 }, method: 'known', params: {} }));
    fromAgent.write(line({ id: [1], method: 'known', params: {} }));
    await tick();
    await tick();
    expect(sent).toEqual([]);
    expect(conn.ignoredLines).toBe(2);
  });

  it('answers -32601 when no request handler is set', async () => {
    const { fromAgent, sent } = pair();
    fromAgent.write(line({ id: 3, method: 'session/request_permission', params: {} }));
    await tick();
    expect(sent[0]).toMatchObject({ id: 3, error: { code: -32601 } });
  });

  it('rejects every pending request on stream end, emits close once, and writes nothing after', async () => {
    const { conn, fromAgent, sent } = pair();
    const closes: unknown[] = [];
    conn.onClose((info) => closes.push(info.reason));
    const a = conn.request('a', {});
    const b = conn.request('b', {}, { timeoutMs: 10_000 });
    fromAgent.end();
    await expect(a).rejects.toBeInstanceOf(AcpClosedError);
    await expect(b).rejects.toBeInstanceOf(AcpClosedError);
    conn.notify('x', {});
    await expect(conn.request('c', {})).rejects.toBeInstanceOf(AcpClosedError);
    expect(closes).toEqual(['stream end']);
    expect(sent.map((m) => m.method)).toEqual(['a', 'b']);
  });
});

describe('AcpConnection with the fake kiro-cli', () => {
  it('initializes, ignores the non-JSON line, and closes with the exit code', async () => {
    const child = spawn(
      process.execPath,
      [FAKE, 'acp', '--agent-engine', 'v3', '--auth-method', 'cli'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      }
    );
    const conn = AcpConnection.fromChild(child);
    const notes: string[] = [];
    conn.onNotification((method) => notes.push(method));
    const closed = new Promise((resolve) => conn.onClose(resolve));
    const init = await conn.request<{ agentCapabilities: { loadSession: boolean } }>(
      'initialize',
      { protocolVersion: 1 },
      { timeoutMs: 5000 }
    );
    expect(init.agentCapabilities.loadSession).toBe(true);
    const created = await conn.request<{ sessionId: string }>('session/new', {
      cwd: '/tmp',
      mcpServers: [],
    });
    expect(created.sessionId).toMatch(/^sess_/);
    expect(notes).toContain('_kiro/mcp/status');
    expect(conn.ignoredLines).toBe(1);
    await stopProcessTree(child, { graceMs: 500, killMs: 1000 });
    expect(await closed).toMatchObject({ reason: expect.any(String) });
    expect(child.exitCode).toBe(0);
  });
});
