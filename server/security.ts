/**
 * Shared security utilities for server proxies.
 *
 * SEC-05: CORS origin restriction
 * SEC-07: Request body size limits
 * SEC-09: maxOutputTokens cap
 */
import type { IncomingMessage, ServerResponse } from 'http';

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
