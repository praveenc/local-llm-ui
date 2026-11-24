/**
 * Shared security utilities for server proxies.
 *
 * SEC-05: CORS origin restriction
 * SEC-07: Request body size limits
 * SEC-09: maxOutputTokens cap
 * SEC-13: Same-origin guard for every /api route
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin } from 'vite';

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
// and through /api/bedrock-aisdk/mcp-status it could start an MCP server command such as
// `npx -y <package>`. This guard rejects those requests before any proxy sees them.
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

/**
 * Read the full request body with a size limit.
 * Returns null and sends a 413 response if the body exceeds the limit.
 */
export async function readBodyWithLimit(
  req: IncomingMessage,
  res: ServerResponse,
  maxSize = MAX_BODY_SIZE
): Promise<string | null> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxSize) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return null;
    }
  }
  return body;
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
 * as an SSE event, so the browser shows it in the chat. Returns false when nothing is sent yet;
 * the caller then sends a JSON error with a status code.
 *
 * Without this check, a proxy that sets a status or header after the stream started throws
 * ERR_HTTP_HEADERS_SENT, and the Vite dev server stops.
 */
export function endStreamWithError(res: ServerResponse, message: string): boolean {
  if (!res.headersSent) return false;
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
  return true;
}
