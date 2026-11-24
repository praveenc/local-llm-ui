/**
 * Kiro CLI status route: GET /api/kiro/status
 *
 * The route runs kiro-cli with fixed arguments (`--version`, `whoami -f json`) and no shell.
 * It returns the account email, so only the app's own pages may call it: the same-origin guard
 * in security.ts (SEC-13) rejects other origins before this middleware runs. The route does not
 * log the email. It only reads: neither command changes any state, and it must stay that way.
 */
import type { Connect } from 'vite';

import type { KiroStatus } from '../src/utils/kiroStatus.ts';
import { createKiroStatusReader } from './kiro/status.ts';

interface KiroStatusSource {
  read(refresh?: boolean): Promise<KiroStatus>;
}

function sendJson(
  res: Parameters<Connect.NextHandleFunction>[1],
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

export function createKiroProxy(
  options: { reader?: KiroStatusSource } = {}
): Connect.NextHandleFunction {
  // Created on the first request, so importing this file does not read the home folder
  let reader = options.reader;

  return async (req, res, next) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return next();
    }
    const pathname = url.pathname;
    if (pathname !== '/api/kiro' && !pathname.startsWith('/api/kiro/')) return next();

    try {
      if (pathname !== '/api/kiro/status') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
        return;
      }
      reader ??= createKiroStatusReader();
      const status = await reader.read(url.searchParams.get('refresh') === '1');
      sendJson(res, 200, status);
    } catch (error) {
      console.warn('[kiro] status route failed:', error instanceof Error ? error.message : error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.end();
    }
  };
}
