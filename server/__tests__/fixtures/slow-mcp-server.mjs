// Test fixture: a minimal stdio MCP server that answers its first request late.
//
// Usage: node slow-mcp-server.mjs <delayMs> <modern|legacy> [pidFile] [exit-after-list]
//
// modern: like the Python MCP SDK 2.x. The first request selects the protocol. After
//         `server/discover`, it rejects `initialize` with error -32022.
// legacy: like a 2025-11-25 server. It answers `server/discover` with "Method not found"
//         and accepts `initialize`.
// pidFile: the server appends its pid to this file when it starts.
// exit-after-list: the server exits 100 ms after it answers `tools/list`.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const delayMs = Number(process.argv[2] ?? 0);
const mode = process.argv[3] ?? 'modern';
const pidFile = process.argv[4];
const exitAfterList = process.argv[5] === 'exit-after-list';
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);
const ready = new Promise((resolve) => setTimeout(resolve, delayMs));
const tools = [{ name: 'echo', inputSchema: { type: 'object' } }];
// 2026-07-28 results carry these fields (copied from a real Python MCP SDK 2.3 server)
const MODERN_RESULT = {
  _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'slow-modern', version: '1.0.0' } },
  resultType: 'complete',
};
let era;

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

function answer({ id, method }) {
  if (mode === 'legacy') {
    if (method === 'initialize') {
      return {
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'slow-legacy', version: '1.0.0' },
        },
      };
    }
    if (method === 'tools/list') return { result: { tools } };
    return { error: { code: -32601, message: 'Method not found' } };
  }

  era ??= method === 'initialize' ? 'legacy' : 'modern';
  if (era === 'modern' && method === 'initialize') {
    return {
      error: {
        code: -32022,
        message:
          'connection is serving the 2026-07-28 protocol; the initialize handshake is not accepted',
      },
    };
  }
  if (method === 'server/discover') {
    return {
      result: {
        ...MODERN_RESULT,
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
      },
    };
  }
  if (method === 'tools/list') return { result: { ...MODERN_RESULT, tools } };
  return { error: { code: -32601, message: 'Method not found' } };
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return; // notifications
  await ready;
  send({ id: message.id, ...answer(message) });
  if (exitAfterList && message.method === 'tools/list') setTimeout(() => process.exit(0), 100);
});
