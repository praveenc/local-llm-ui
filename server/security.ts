/**
 * Shared security utilities for server proxies.
 *
 * SEC-05: CORS origin restriction
 * SEC-07: Request body size limits
 * SEC-09: maxOutputTokens cap
 * SEC-13: Same-origin guard for every /api route
 * SEC-22: Chat request validation, before any side effect
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin } from 'vite';

import type { MCPServerConfig } from '../src/types/mcp.ts';
import {
  ALLOWED_FORMATS,
  MAX_FILES_PER_MESSAGE,
  MAX_FILE_BYTES,
  kindOfFormat,
  messageLimitReason,
} from '../src/utils/attachments.ts';

// ─── SEC-05: CORS ────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);

/**
 * Set CORS headers restricted to known dev server origins.
 * Falls back to blocking if the origin isn't recognized.
 */
export function setCORSHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedHeaders = 'Content-Type'
): void {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // No CORS header = browser blocks the request
    // Still allow same-origin requests (no Origin header)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
}

// ─── SEC-13: Same-origin guard ───────────────────────────────────────────────
//
// The CORS headers above only stop a page on another site from reading a response. They do not
// stop the request: a cross-site form post or a no-cors fetch with a text/plain body reaches the
// proxy, which parses it as JSON. That started a chat with the host's AWS credentials or API keys,
// and through /api/bedrock-aisdk/mcp-status it could start any program on the host as an MCP
// server (a name on PATH or a full path), for example `npx -y <package>`. This guard rejects
// those requests before any proxy sees them.
//
// Rules for new routes: a GET must not change state (old browsers send a cross-site GET without
// Origin or Sec-Fetch-Site), and a WebSocket upgrade does not pass through this middleware, so it
// needs its own check.

/** Sec-Fetch-Site values of requests that the app's own pages make, or that a person typed */
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

/** Methods that carry a body. They must send JSON, which a cross-site page cannot send without a preflight */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiRequestRejection {
  status: 403 | 415;
  error: string;
  reason: string;
}

function startsWithApi(path: string): boolean {
  return path === '/api' || path.startsWith('/api/') || path.startsWith('/api?');
}

/**
 * The path of a request target as a router can read it: absolute-form targets
 * (`http://host/api/x`) and repeated leading slashes reduced, and `.` and `..` segments resolved.
 */
function normalizedPath(url: string): string | undefined {
  try {
    const parsed = url.startsWith('/')
      ? new URL(url.replace(/^\/+/, '/'), 'http://localhost')
      : new URL(url);
    return parsed.pathname;
  } catch {
    return undefined;
  }
}

/**
 * True when a router could take the URL for /api or a path under it. The proxies match the raw
 * `req.url` with `startsWith`, and some parse it with `new URL()` first, so check both forms.
 * Upper case counts too, so a later route that ignores case is covered.
 */
export function isApiPath(url: string | undefined): boolean {
  if (!url) return false;
  const forms = [url, normalizedPath(url)].filter((form): form is string => !!form);
  return forms.some((form) => startsWithApi(form.toLowerCase()));
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim() || undefined;
}

/** host[:port] of a Host or X-Forwarded-Host value, with the default port of the scheme removed */
function normalizedHost(host: string, protocol: string): string | undefined {
  try {
    return new URL(`${protocol}//${host}`).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a request to /api comes from the app's own pages.
 *
 * 1. Sec-Fetch-Site, when present, must be same-origin or none. Browsers set it and pages cannot
 *    change it. It also rejects other apps on localhost (same-site).
 * 2. Without Sec-Fetch-Site (older browsers, plain-HTTP addresses that are not localhost), an
 *    Origin header must name the host of the request: the Host header, or for an https Origin
 *    X-Forwarded-Host. A tunnel sends Host as localhost and its public https host in
 *    X-Forwarded-Host, and replaces a value that the client sends. A page cannot add
 *    X-Forwarded-Host without a preflight, and the preflight fails this rule.
 * 3. POST, PUT, PATCH, and DELETE must have Content-Type application/json.
 *
 * Requests with neither header (curl, scripts, tests) are not from a browser and pass rules 1 and 2.
 *
 * Returns null when the request may continue.
 */
export function checkApiRequest(req: IncomingMessage): ApiRequestRejection | null {
  const fetchSite = firstHeader(req.headers['sec-fetch-site'])?.toLowerCase();
  const origin = firstHeader(req.headers.origin);

  if (fetchSite !== undefined) {
    if (!ALLOWED_FETCH_SITES.has(fetchSite)) {
      return {
        status: 403,
        error: 'Cross-site request blocked',
        reason: `sec-fetch-site ${fetchSite}`,
      };
    }
  } else if (origin !== undefined) {
    let from: URL | undefined;
    try {
      from = new URL(origin);
    } catch {
      from = undefined;
    }
    const isWeb = from?.protocol === 'http:' || from?.protocol === 'https:';
    const candidates = [firstHeader(req.headers.host)];
    if (from?.protocol === 'https:') candidates.push(firstHeader(req.headers['x-forwarded-host']));
    const hosts = candidates
      .filter((host): host is string => !!host)
      .map((host) => normalizedHost(host, from?.protocol ?? 'http:'));
    if (!from || !isWeb || !hosts.includes(from.host.toLowerCase())) {
      return {
        status: 403,
        error: 'Cross-site request blocked',
        reason: 'origin does not match host',
      };
    }
  }

  if (BODY_METHODS.has(req.method?.toUpperCase() ?? '')) {
    const contentType = firstHeader(req.headers['content-type'])
      ?.split(';')[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      return {
        status: 415,
        error: 'Send the request body as JSON (Content-Type: application/json)',
        reason: `content-type ${contentType ?? 'missing'}`,
      };
    }
  }

  return null;
}

/** Text from a request for one log line: no control characters, at most 200 characters, quoted */
function forLog(value: string | undefined): string {
  const printable = [...(value ?? '')]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return JSON.stringify(printable.slice(0, 200));
}

/**
 * Connect middleware for the Vite dev and preview servers. Register it before every proxy and
 * before `server.proxy`: Vite runs middlewares from `configureServer` before its proxy middleware.
 */
export function createApiGuard() {
  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
    if (!isApiPath(req.url)) {
      next();
      return;
    }
    const rejection = checkApiRequest(req);
    if (!rejection) {
      next();
      return;
    }
    const path = (req.url ?? '').split('?')[0];
    console.warn(
      `[api-guard] Blocked ${forLog(req.method)} ${forLog(path)} from ${forLog(firstHeader(req.headers.origin) ?? 'no origin')}: ${forLog(rejection.reason)}`
    );
    res.statusCode = rejection.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify({ error: rejection.error }));
  };
}

/**
 * The guard as a Vite plugin. It uses `enforce: 'pre'` and is the first plugin in vite.config.ts,
 * so its middleware runs before every other `configureServer` middleware. Vite adds all of those
 * before `server.proxy` and `preview.proxy`, so the guard also covers the plain proxies to Ollama
 * and LM Studio. vite.config.ts turns off Vite's own CORS middleware, which would otherwise answer
 * preflights from other localhost ports before the guard runs.
 */
export function apiGuardPlugin(): Plugin {
  return {
    name: 'api-guard',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(createApiGuard());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiGuard());
    },
  };
}

// ─── SEC-07: Request Body Size Limit ─────────────────────────────────────────

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

/** Body limit of the plain proxies to Ollama and LM Studio. The app sends them GETs with no body */
export const PLAIN_PROXY_BODY_LIMIT = 16 * 1024;

const BODY_TOO_LARGE = 'Request body too large';

/**
 * Read the full request body with a size limit in bytes.
 * Returns null and sends a 413 response if the body exceeds the limit.
 */
export async function readBodyWithLimit(
  req: IncomingMessage,
  res: ServerResponse,
  maxSize = MAX_BODY_SIZE
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > maxSize) {
      sendJsonError(res, 413, BODY_TOO_LARGE);
      return null;
    }
    chunks.push(bytes);
  }
  // Decode once, so that a character split across two chunks stays whole
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A body limit for a request that a proxy pipes to an upstream (Vite's `server.proxy`), where the
 * body is never read into memory. Register it on http-proxy-3's `start` event, which runs right
 * before `req.pipe(proxyReq)`: a declared Content-Length over the limit, or more bytes than the
 * limit, get a 413 and the request is destroyed. Returns false when it refused the request.
 *
 * The upstream can get at most one read of the socket (up to 64 KB) past the limit: the pipe
 * gets the chunk that crosses the limit too. A declared Content-Length is refused before any byte.
 */
export function limitStreamedBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxSize = MAX_BODY_SIZE
): boolean {
  let refused = false;
  const refuse = () => {
    if (refused) return;
    refused = true;
    req.off('data', count);
    if (!res.headersSent && !res.writableEnded) {
      res.setHeader('Connection', 'close');
      sendJsonError(res, 413, BODY_TOO_LARGE);
    }
    // The 413 is sent, so the proxy does not destroy its upstream request when the response
    // closes. http-proxy-3 does destroy it, with no log line, for a client socket that ends with
    // ECONNRESET, so end the request that way. The no-op listener keeps a server with no other
    // 'error' listener on the request from stopping.
    req.on('error', () => undefined);
    req.destroy(Object.assign(new Error(BODY_TOO_LARGE), { code: 'ECONNRESET' }));
  };
  let size = 0;
  function count(chunk: Buffer | string) {
    size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    if (size > maxSize) refuse();
  }

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxSize) {
    refuse();
    return false;
  }
  // Added in the same tick as the pipe, so this listener sees every chunk that the upstream gets
  req.on('data', count);
  return true;
}

// ─── Chat proxies: errors, request validation, event stream, abort ───────────

/** Most characters of an error text that a proxy sends to the browser */
export const MAX_ERROR_LENGTH = 500;

/** An error text cut to MAX_ERROR_LENGTH characters, without a half surrogate pair at the end */
export function capErrorText(text: string): string {
  if (text.length <= MAX_ERROR_LENGTH) return text;
  // A high surrogate at the cut would leave half of a character
  const last = text.charCodeAt(MAX_ERROR_LENGTH - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_ERROR_LENGTH - 1 : MAX_ERROR_LENGTH;
  return text.slice(0, end);
}

/**
 * Send a JSON error with a status. The text is cut to MAX_ERROR_LENGTH characters. When
 * `startEventStream` set the SSE headers but no byte went out, those headers are removed, so the
 * JSON reply does not say `no-cache` and `keep-alive`.
 */
export function sendJsonError(res: ServerResponse, status: number, message: string): void {
  if (!res.headersSent) {
    res.removeHeader('Cache-Control');
    res.removeHeader('Connection');
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: capErrorText(message) }));
}

export interface ChatRequestFile {
  name: string;
  format: string;
  /** base64 */
  bytes: string;
}

export interface ChatRequestMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** The files of a user message; each proxy turns them into its provider's parts (model-messages.ts) */
  files?: ChatRequestFile[];
}

/** A chat body after `readChatRequest`. The proxy checks its own extra fields */
export interface ChatRequest {
  model: string;
  /** With the messages that have no text and no files left out */
  messages: ChatRequestMessage[];
  max_tokens?: number;
  enableWebSearch?: boolean;
  mcpServers?: MCPServerConfig[];
  /** Checked by buildReasoningParams and the other thinking helpers */
  thinkingEffort?: unknown;
  /** Most model calls in one reply when tools are on; clamped by clampToolSteps */
  maxToolSteps?: unknown;
  /** Groq or Cerebras; checked by the AI SDK proxy */
  provider?: unknown;
}

export interface ReadChatRequestOptions {
  /** Body limit in bytes (default 10 MB) */
  maxSize?: number;
}

const MODEL_ID_MAX = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

const FILE_NAME_MAX = 255;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** The decoded size of a base64 string */
function base64DecodedSize(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

/**
 * A file of a chat message: a name of 1 to 255 characters with no control character, a format
 * from the allowed list, and base64 bytes of at most 4.5 MB decoded (D-H)
 */
function isChatFile(value: unknown): value is ChatRequestFile {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.length >= 1 &&
    value.name.length <= FILE_NAME_MAX &&
    !hasControlCharacter(value.name) &&
    typeof value.format === 'string' &&
    ALLOWED_FORMATS.includes(value.format) &&
    typeof value.bytes === 'string' &&
    value.bytes.length % 4 === 0 &&
    BASE64_PATTERN.test(value.bytes) &&
    base64DecodedSize(value.bytes) <= MAX_FILE_BYTES
  );
}

function isChatMessage(value: unknown): value is ChatRequestMessage {
  if (!isRecord(value)) return false;
  return (
    (value.role === 'user' || value.role === 'assistant' || value.role === 'system') &&
    typeof value.content === 'string' &&
    (value.files === undefined ||
      (Array.isArray(value.files) &&
        value.files.length <= MAX_FILES_PER_MESSAGE &&
        value.files.every(isChatFile)))
  );
}

/** The error text for a parsed chat body, or the request when the body is valid */
function checkChatRequest(body: unknown): ChatRequest | string {
  if (!isRecord(body) || typeof body.model !== 'string' || !Array.isArray(body.messages)) {
    return 'Invalid chat request';
  }
  const { model, messages, max_tokens, enableWebSearch, mcpServers } = body;
  if (!model.trim()) return 'Model is required';
  if (model.length > MODEL_ID_MAX) return 'Model ID too long';
  if (hasControlCharacter(model)) return 'Invalid model ID format';
  if (!messages.every(isChatMessage)) return 'Invalid messages array';
  // The limits of one message (D-H): 20 images, 5 documents, about 7.5 MB raw
  for (const message of messages) {
    const files = (message.files ?? []).map((file) => ({
      kind: kindOfFormat(file.format),
      size: base64DecodedSize(file.bytes),
    }));
    const reason = messageLimitReason(files);
    if (reason) return reason;
  }
  if (
    max_tokens !== undefined &&
    (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1)
  ) {
    return 'max_tokens must be a positive integer';
  }
  if (enableWebSearch !== undefined && typeof enableWebSearch !== 'boolean') {
    return 'enableWebSearch must be a boolean';
  }
  if (mcpServers !== undefined && !Array.isArray(mcpServers)) {
    return 'mcpServers must be an array';
  }
  const nonEmpty = messages.filter(
    (message) => message.content.trim().length > 0 || (message.files?.length ?? 0) > 0
  );
  if (nonEmpty.length === 0) return 'At least one non-empty message is required';
  return { ...(body as unknown as ChatRequest), messages: nonEmpty };
}

/**
 * Read and check the body of a chat request (SEC-22): the size limit, JSON, and the fields that
 * every chat proxy uses. Answers 413 or 400 JSON itself and returns null; the proxy then returns.
 * Call it before any key check, MCP start, or SSE header, so a bad body has no side effect.
 */
export async function readChatRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ReadChatRequestOptions = {}
): Promise<ChatRequest | null> {
  const raw = await readBodyWithLimit(req, res, options.maxSize);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJsonError(res, 400, 'Invalid JSON body');
    return null;
  }
  const checked = checkChatRequest(parsed);
  if (typeof checked === 'string') {
    sendJsonError(res, 400, checked);
    return null;
  }
  return checked;
}

/**
 * Set the SSE headers. Call it right before the stream loop: after the request checks, the key
 * checks, and the MCP start, so that an error before it still gets a JSON status.
 */
export function startEventStream(res: ServerResponse): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

/**
 * A signal that aborts when the browser closes the connection before the response ended. It
 * listens on the response: once the body is read, the request's own 'close' has already fired.
 */
export function abortOnClose(res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  if (res.destroyed && !res.writableEnded) {
    controller.abort();
  } else {
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
  }
  return controller.signal;
}

/**
 * True for the error of a call that `abortOnClose` stopped. It checks the name only: `fetch` throws
 * a DOMException, which is not an `Error` of every realm.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * True for an `AbortError` after the browser closed the connection: the proxy stopped the call
 * itself, so it is not a proxy error and needs no log and no reply.
 */
export function isAbortAfterClientLeft(error: unknown, res: ServerResponse): boolean {
  return isAbortError(error) && res.destroyed;
}

// ─── SEC-09: maxOutputTokens Cap ─────────────────────────────────────────────

const MAX_OUTPUT_TOKENS_CAP = 32_768;
const DEFAULT_OUTPUT_TOKENS = 2048;

/**
 * Cap maxOutputTokens to a safe upper bound.
 */
export function capMaxTokens(requestedTokens?: number): number {
  return Math.min(requestedTokens ?? DEFAULT_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_CAP);
}

// ─── Stream errors after the response started ────────────────────────────────

/**
 * Finish a response whose status and headers are already sent (an SSE stream). Writes the error
 * as an SSE event, cut to MAX_ERROR_LENGTH characters, so the browser shows it in the chat. Returns false when nothing is sent yet;
 * the caller then sends a JSON error with a status code.
 *
 * Without this check, a proxy that sets a status or header after the stream started throws
 * ERR_HTTP_HEADERS_SENT, and the Vite dev server stops.
 */
export function endStreamWithError(res: ServerResponse, message: string): boolean {
  if (!res.headersSent) return false;
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: capErrorText(message) })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
  return true;
}
