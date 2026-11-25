/**
 * Kiro CLI routes:
 *
 * - GET  /api/kiro/status: installed, version, signed in or out (cached for 30 s)
 * - POST /api/kiro/login: signs in. Streams `data: {"login": <event>}` lines, then `[DONE]`, with
 *   a `: ping` comment every 15 s so that a tunnel does not close the idle stream
 * - POST /api/kiro/login/cancel: stops the sign-in whose `runId` (from the `started` event) the
 *   JSON body names
 * - POST /api/kiro/logout: signs out and returns the status
 *
 * The routes run kiro-cli with fixed arguments and no shell. The login route builds its arguments
 * from input that the shared checks in src/utils/kiroLogin.ts have validated, sends the code and
 * the sign-in URL only to the app's own page, and never logs them. The status route returns the
 * account email. The same-origin guard in security.ts (SEC-13) rejects other origins before this
 * middleware runs, and it requires JSON on every POST. The status route only reads: it must stay
 * a GET that changes nothing. Every route that changes state is a POST.
 */
import type { Connect } from 'vite';

import { parseKiroLoginMethod } from '../src/utils/kiroLogin.ts';
import type { KiroLoginEvent } from '../src/utils/kiroLogin.ts';
import type { KiroStatus } from '../src/utils/kiroStatus.ts';
import type { KiroEnvironment } from './kiro/binary.ts';
import {
  KiroLoginBusyError,
  LOGIN_BUSY_MESSAGE,
  LOGOUT_BUSY_MESSAGE,
  createKiroLogin,
} from './kiro/login.ts';
import type { KiroLogin } from './kiro/login.ts';
import { createKiroStatusReader } from './kiro/status.ts';
import { readBodyWithLimit } from './security.ts';

interface KiroStatusSource {
  read(refresh?: boolean): Promise<KiroStatus>;
}

export type KiroProxy = Connect.NextHandleFunction & {
  /** Stops a running sign-in, for the end of the server */
  close(): void;
};

export interface KiroProxyOptions {
  reader?: KiroStatusSource;
  /** Where to look for kiro-cli. Tests set it; the default is the real computer. */
  environment?: KiroEnvironment;
  loginTimeoutMs?: number;
  /** How often the login stream sends a `: ping` comment. Tests make it short. */
  loginHeartbeatMs?: number;
}

const LOGIN_BODY_LIMIT = 16 * 1024;
const CANCEL_BODY_LIMIT = 1024;
const HEARTBEAT_MS = 15_000;

type Res = Parameters<Connect.NextHandleFunction>[1];

function sendJson(
  res: Res,
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

export function createKiroProxy(options: KiroProxyOptions = {}): KiroProxy {
  // Created on the first request, so importing this file does not read the home folder
  let reader = options.reader;
  let login: KiroLogin | undefined;

  const getReader = (): KiroStatusSource =>
    (reader ??= createKiroStatusReader({ environment: options.environment }));
  const getLogin = (): KiroLogin =>
    (login ??= createKiroLogin({
      environment: options.environment,
      statusReader: getReader(),
      timeoutMs: options.loginTimeoutMs,
    }));

  async function handleLogin(req: Parameters<Connect.NextHandleFunction>[0], res: Res) {
    const body = await readBodyWithLimit(req, res, LOGIN_BODY_LIMIT);
    if (body === null) return;
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'The request body is not valid JSON' });
      return;
    }
    const parsed = parseKiroLoginMethod(json);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }

    const controller = getLogin();
    if (controller.isRunning()) {
      sendJson(res, 409, { error: LOGIN_BUSY_MESSAGE });
      return;
    }
    if (controller.isSigningOut()) {
      sendJson(res, 409, { error: LOGOUT_BUSY_MESSAGE });
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const write = (event: KiroLoginEvent) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify({ login: event })}\n\n`);
    };

    // Many tunnels close a stream that sends nothing for a minute or so
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
    }, options.loginHeartbeatMs ?? HEARTBEAT_MS);
    heartbeat.unref();

    // A page that closes or reloads stops the sign-in
    let ended = false;
    res.on('close', () => {
      clearInterval(heartbeat);
      if (!ended && !res.writableEnded) controller.cancel();
    });

    try {
      await controller.start(parsed.value, write);
    } catch (error) {
      if (!(error instanceof KiroLoginBusyError)) {
        console.warn('[kiro] login route failed:', error instanceof Error ? error.message : error);
      }
      write({
        state: 'error',
        message:
          error instanceof KiroLoginBusyError ? error.message : 'Could not start the sign-in',
      });
    }
    ended = true;
    clearInterval(heartbeat);
    if (!res.writableEnded && !res.destroyed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  const proxy: Connect.NextHandleFunction = async (req, res, next) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return next();
    }
    const pathname = url.pathname;
    if (pathname !== '/api/kiro' && !pathname.startsWith('/api/kiro/')) return next();

    try {
      if (pathname === '/api/kiro/status') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
          return;
        }
        const status = await getReader().read(url.searchParams.get('refresh') === '1');
        sendJson(res, 200, status);
        return;
      }

      if (
        pathname === '/api/kiro/login' ||
        pathname === '/api/kiro/login/cancel' ||
        pathname === '/api/kiro/logout'
      ) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
          return;
        }
        if (pathname === '/api/kiro/login') {
          await handleLogin(req, res);
          return;
        }
        if (pathname === '/api/kiro/login/cancel') {
          const body = await readBodyWithLimit(req, res, CANCEL_BODY_LIMIT);
          if (body === null) return;
          let runId: unknown;
          try {
            runId = body ? (JSON.parse(body) as { runId?: unknown } | null)?.runId : undefined;
          } catch {
            sendJson(res, 400, { error: 'The request body is not valid JSON' });
            return;
          }
          // Only the run that the page started: a late cancel must not stop a newer sign-in
          const cancelled = typeof runId === 'string' && (login?.cancel(runId) ?? false);
          sendJson(res, 200, { cancelled });
          return;
        }
        // Logout takes no input. Read the body so that the connection is free.
        req.resume();
        try {
          sendJson(res, 200, await getLogin().logout());
        } catch (error) {
          if (error instanceof KiroLoginBusyError) {
            sendJson(res, 409, { error: error.message });
            return;
          }
          console.warn('[kiro] sign-out failed:', error instanceof Error ? error.message : error);
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : 'Could not sign out',
          });
        }
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      console.warn('[kiro] route failed:', error instanceof Error ? error.message : error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.end();
    }
  };

  return Object.assign(proxy, { close: () => login?.close() });
}
