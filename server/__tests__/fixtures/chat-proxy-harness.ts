// Shared helpers for the chat proxy tests: a real HTTP server around one handler, the bad bodies
// that every chat proxy must refuse with 400 (AUDIT-A2 #126), and mock models.
import { MockLanguageModelV4 } from 'ai/test';
import { type IncomingMessage, type ServerResponse, createServer } from 'http';
import type { AddressInfo } from 'net';

export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => unknown;

export interface Reply {
  status: number;
  headers: Headers;
  body: string;
}

/** A server that runs the handler; a request that the handler passes on gets 404 */
async function listen(handler: Handler) {
  const server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

/** POST a body as written (a string is sent as it is, anything else as JSON) */
export async function post(
  handler: Handler,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Reply> {
  const { server, base } = await listen(handler);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.text() };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/**
 * POST a body, read the first chunk of the reply, wait, and close the connection, as a browser
 * does when the user stops a reply or closes the tab. Waits at least 100 ms before the close:
 * with less, the server does not see the close in this harness (AUDIT-A2 Q3).
 */
export async function postAndLeave(
  handler: Handler,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<void> {
  const { server, base } = await listen(handler);
  const controller = new AbortController();
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    await response.body?.getReader().read();
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/**
 * POST a body and close the connection after 150 ms, before any reply byte, then wait until the
 * handler has finished. For a handler that is still busy (an MCP start) when the browser leaves.
 */
export async function postAndLeaveEarly(
  handler: Handler,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<void> {
  let handled: unknown;
  const { server, base } = await listen((req, res, next) => {
    handled = handler(req, res, next);
    return handled;
  });
  const controller = new AbortController();
  try {
    const request = fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await request;
    await handled;
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/** An MCP start that ends with an AbortError once the browser has left (after 400 ms) */
export const abortedMcpStart = async (): Promise<never> => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  throw new DOMException('This operation was aborted', 'AbortError');
};

/** An MCP server that a bad body names, so that a test can check that it never starts */
export const MCP_SERVER = { id: 's1', name: 'files', type: 'stdio', command: 'npx', enabled: true };

/**
 * Give a body that parses to an object an MCP server, unless it has its own `mcpServers`. Then a
 * "no MCP start" assertion proves that validation runs before the MCP start.
 */
function withMcpServer(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return body;
  if ('mcpServers' in parsed) return body;
  return JSON.stringify({ ...parsed, mcpServers: [MCP_SERVER] });
}

const RAW_BAD_BODIES: Array<[string, string]> = [
  ['invalid JSON', '{'],
  ['an empty object', '{}'],
  ['null', 'null'],
  ['an array', '[]'],
  ['a number model and a string messages', '{"model":42,"messages":"x"}'],
  ['an empty model', '{"model":"  ","messages":[{"role":"user","content":"Hi"}]}'],
  [
    'a model over 256 characters',
    JSON.stringify({ model: 'm'.repeat(257), messages: [{ role: 'user', content: 'Hi' }] }),
  ],
  [
    'a model with a control character',
    JSON.stringify({ model: 'm\nx', messages: [{ role: 'user', content: 'Hi' }] }),
  ],
  ['a tool message', '{"model":"m","messages":[{"role":"tool","content":"Hi"}]}'],
  ['a message with no content', '{"model":"m","messages":[{"role":"user"}]}'],
  ['content that is not a string', '{"model":"m","messages":[{"role":"user","content":[1]}]}'],
  [
    'files that are not a list',
    '{"model":"m","messages":[{"role":"user","content":"Hi","files":5}]}',
  ],
  [
    'a file with no bytes',
    '{"model":"m","messages":[{"role":"user","content":"Hi","files":[{"name":"a","format":"pdf"}]}]}',
  ],
  ['max_tokens 0', '{"model":"m","messages":[{"role":"user","content":"Hi"}],"max_tokens":0}'],
  ['max_tokens 1.5', '{"model":"m","messages":[{"role":"user","content":"Hi"}],"max_tokens":1.5}'],
  [
    'enableWebSearch "yes"',
    '{"model":"m","messages":[{"role":"user","content":"Hi"}],"enableWebSearch":"yes"}',
  ],
  ['mcpServers 5', '{"model":"m","messages":[{"role":"user","content":"Hi"}],"mcpServers":5}'],
  ['no messages', '{"model":"m","messages":[]}'],
  ['only empty messages', '{"model":"m","messages":[{"role":"user","content":"   "}]}'],
];

/**
 * Bodies that every chat proxy answers with 400 and an error text. Each body that is a JSON object
 * names an MCP server (see `withMcpServer`).
 */
export const BAD_BODIES: Array<[string, string]> = RAW_BAD_BODIES.map(([name, body]) => [
  name,
  withMcpServer(body),
]);

const FINISH = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
} as const;

/** A model that streams the given text deltas and then finishes */
export function textModel(deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: '1' });
          for (const delta of deltas) controller.enqueue({ type: 'text-delta', id: '1', delta });
          controller.enqueue({ type: 'text-end', id: '1' });
          controller.enqueue(FINISH);
          controller.close();
        },
      }),
    }),
  });
}

/**
 * A model whose stream sends one text delta and then an error part: an `Error` with the given
 * text, or the given error itself
 */
export function errorPartModel(error: string | Error) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: '1' });
          controller.enqueue({ type: 'text-delta', id: '1', delta: 'Hi' });
          controller.enqueue({
            type: 'error',
            error: typeof error === 'string' ? new Error(error) : error,
          });
          controller.close();
        },
      }),
    }),
  });
}

/** A model that sends one text delta and never finishes. Records the abort signal of the call */
export function hangingModel(seen: { signal?: AbortSignal }) {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      seen.signal = abortSignal;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: '1' });
            controller.enqueue({ type: 'text-delta', id: '1', delta: 'Hi' });
            abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason));
          },
        }),
      };
    },
  });
}

/** The SSE data payloads of a body, without [DONE] */
export const events = (body: string): Array<Record<string, unknown>> =>
  body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
