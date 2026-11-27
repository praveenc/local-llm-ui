/** Asks the server for the MCP servers in the config files of other tools (item 25) */
import type { MCPImportRead, MCPImportScan } from '@/utils/mcpImport';

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`The import route answered ${response.status}`);
  return (await response.json()) as T;
}

/** The servers in the files, with no secret value. Throws when the request fails. */
export async function scanMCPImport(signal?: AbortSignal): Promise<MCPImportScan> {
  const scan = await post<MCPImportScan>('/api/mcp/import/scan', {}, signal);
  if (!scan || !Array.isArray(scan.files)) throw new Error('The scan answer is not valid');
  return scan;
}

/** The selected servers with their values. Throws when the request fails or is aborted. */
export async function readMCPImport(keys: string[], signal?: AbortSignal): Promise<MCPImportRead> {
  const result = await post<MCPImportRead>('/api/mcp/import/read', { keys }, signal);
  if (!result || !Array.isArray(result.servers) || !Array.isArray(result.skipped)) {
    throw new Error('The read answer is not valid');
  }
  return result;
}
