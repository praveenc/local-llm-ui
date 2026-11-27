/**
 * Routes of the MCP import (item 25):
 *
 * - `POST /api/mcp/import/scan` (body at most 1 KB): the servers in the other tools' files,
 *   with no secret value.
 * - `POST /api/mcp/import/read` (body at most 16 KB, `{ keys: string[] }`): the selected servers
 *   with their values.
 *
 * Both read files in the home folder and `read` returns secrets, so both are POST with JSON
 * behind the same-origin guard (SEC-13, `apiGuardPlugin` runs first) and take no path from the
 * browser. Errors are short JSON with no path and no value.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

import { MAX_READ_KEYS, MAX_READ_KEY_LENGTH } from '../src/utils/mcpImport.ts';
import { createMCPImporter } from './mcp-import.ts';
import type { MCPImporter, MCPImporterOptions } from './mcp-import.ts';
import { readBodyWithLimit } from './security.ts';

export const MCP_IMPORT_SCAN_BODY_LIMIT = 1024;
export const MCP_IMPORT_READ_BODY_LIMIT = 16 * 1024;

function sendJson(
  res: ServerResponse,
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

/** The keys of a read body, or an error text */
export function parseReadRequest(json: unknown): { keys: string[] } | { error: string } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { error: 'The request needs a list of keys' };
  }
  const keys = Object.hasOwn(json, 'keys') ? (json as { keys: unknown }).keys : undefined;
  if (!Array.isArray(keys) || keys.length === 0)
    return { error: 'The request needs a list of keys' };
  if (keys.length > MAX_READ_KEYS) return { error: `At most ${MAX_READ_KEYS} keys` };
  if (
    !keys.every(
      (key) => typeof key === 'string' && key.length > 0 && key.length <= MAX_READ_KEY_LENGTH
    )
  ) {
    return { error: 'A key is not valid' };
  }
  return { keys: keys as string[] };
}

/** The JSON body, or undefined after a 400 or 413 was sent. An empty body is `{}`. */
async function readJson(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number
): Promise<unknown> {
  const body = await readBodyWithLimit(req, res, limit);
  if (body === null) return undefined;
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'The request body is not valid JSON' });
    return undefined;
  }
}

export function createMCPImportProxy(
  options: MCPImporterOptions & { importer?: MCPImporter } = {}
): Connect.NextHandleFunction {
  const importer = options.importer ?? createMCPImporter(options);

  return async (req, res, next) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return next();
    }
    if (pathname !== '/api/mcp' && !pathname.startsWith('/api/mcp/')) return next();

    const route =
      pathname === '/api/mcp/import/scan'
        ? 'scan'
        : pathname === '/api/mcp/import/read'
          ? 'read'
          : null;
    if (!route) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return;
    }

    try {
      if (route === 'scan') {
        const json = await readJson(req, res, MCP_IMPORT_SCAN_BODY_LIMIT);
        if (json === undefined) return;
        sendJson(res, 200, await importer.scan());
        return;
      }
      const json = await readJson(req, res, MCP_IMPORT_READ_BODY_LIMIT);
      if (json === undefined) return;
      const parsed = parseReadRequest(json);
      if ('error' in parsed) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const result = await importer.read(parsed.keys);
      // Counts only: never a name, a path, or a value
      console.log(
        `[mcp-import] read: ${result.servers.length} returned, ${result.skipped.length} skipped`
      );
      sendJson(res, 200, result);
    } catch {
      console.warn(`[mcp-import] ${route} failed`);
      if (!res.headersSent) sendJson(res, 500, { error: 'The import failed' });
      else res.end();
    }
  };
}
