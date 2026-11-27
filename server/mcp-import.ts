/**
 * Read MCP servers from the config files of other tools (item 25, D17).
 *
 * Only a fixed list of files in the home folder of the dev server (`os.homedir()`). The browser
 * never sends a path. Each file: a regular file after links, at most 4 MB, strict `JSON.parse`,
 * only its own top-level `mcpServers` object. `scan()` returns no secret value (see
 * `src/utils/mcpImport.ts`); `read(keys)` returns the values of the selected servers only.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';

import { generateMCPServerId } from '../src/types/mcp.ts';
import {
  MCP_IMPORT_TOOLS,
  URL_NOT_VALID,
  cannotRunReason,
  hasPlaceholder,
  homeForm,
  homeFormArgs,
  homePrefix,
  isSafeServerName,
  maskArguments,
  parseReadKey,
  readKey,
  shortHash,
  stripUrl,
  toServerConfig,
} from '../src/utils/mcpImport.ts';
import type {
  ImportedServer,
  MCPImportRead,
  MCPImportScan,
  MCPImportToolId,
  ScannedFile,
  ScannedFileStatus,
  ScannedServer,
} from '../src/utils/mcpImport.ts';
import { validateUrlSecurity } from './mcp-manager.ts';

/** The most that the import reads of one file */
export const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024;

type Adapter = 'generic' | 'gemini' | 'windsurf';

interface ImportFile {
  tool: MCPImportToolId;
  /** Path below the home folder, with `/` */
  path: string;
  adapter: Adapter;
}

/** The fixed list (DECISIONS item 25), in the order that decides which tool a group shows */
export function importFiles(platform: NodeJS.Platform = process.platform): ImportFile[] {
  return [
    { tool: 'kiro', path: '.kiro/settings/mcp.json', adapter: 'generic' },
    { tool: 'pi', path: '.pi/agent/mcp.json', adapter: 'generic' },
    { tool: 'claude-code', path: '.claude.json', adapter: 'generic' },
    { tool: 'cursor', path: '.cursor/mcp.json', adapter: 'generic' },
    {
      tool: 'claude-desktop',
      path:
        platform === 'darwin'
          ? 'Library/Application Support/Claude/claude_desktop_config.json'
          : '.config/Claude/claude_desktop_config.json',
      adapter: 'generic',
    },
    { tool: 'gemini', path: '.gemini/settings.json', adapter: 'gemini' },
    { tool: 'devin', path: '.config/devin/mcp_config.json', adapter: 'windsurf' },
    { tool: 'windsurf', path: '.codeium/windsurf/mcp_config.json', adapter: 'windsurf' },
  ];
}

const TOOL_LABEL = Object.fromEntries(MCP_IMPORT_TOOLS.map((t) => [t.id, t.label])) as Record<
  MCPImportToolId,
  string
>;

// ─── Reading one file ────────────────────────────────────────────────────────

type FileRead =
  { status: 'ok'; servers: Record<string, unknown> } | { status: Exclude<ScannedFileStatus, 'ok'> };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = (obj: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(obj, key) ? obj[key] : undefined;

/** Read a file: missing, too large, not a regular file, or not JSON give a status, never a throw */
async function readImportFile(file: string): Promise<FileRead> {
  let info;
  try {
    // stat follows links: a link to a folder or a device is not a file
    info = await stat(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable' };
  }
  if (!info.isFile()) return { status: 'unreadable' };
  if (info.size > MAX_IMPORT_FILE_BYTES) return { status: 'too-large' };

  let text: string;
  try {
    // O_NONBLOCK: a file that became a FIFO after the stat cannot hang the open
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const again = await handle.stat();
      if (!again.isFile()) return { status: 'unreadable' };
      if (again.size > MAX_IMPORT_FILE_BYTES) return { status: 'too-large' };
      // The size of the file and one byte more, so that a file that grew after the stat is
      // caught: over the limit it is too large, under it the read is not the file that we saw
      const buffer = Buffer.alloc(Math.min(again.size, MAX_IMPORT_FILE_BYTES) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_IMPORT_FILE_BYTES) return { status: 'too-large' };
      if (length > again.size) return { status: 'unreadable' };
      text = buffer.subarray(0, length).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return { status: 'unreadable' };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: 'unreadable' };
  }
  if (!isObject(json)) return { status: 'unreadable' };
  const servers = own(json, 'mcpServers');
  if (servers === undefined) return { status: 'ok', servers: {} };
  if (!isObject(servers)) return { status: 'unreadable' };
  return { status: 'ok', servers };
}

// ─── Adapters ────────────────────────────────────────────────────────────────

/** A text record; entries whose value is not text are left out */
function textRecord(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!isObject(value)) return null;
  const out: Record<string, string> = {};
  for (const name of Object.keys(value)) {
    const item = value[name];
    if (!isSafeServerName(name) || typeof item !== 'string') continue;
    out[name] = item;
  }
  return out;
}

/** The remote transport that a file names: `type` or `transport`, `sse` or http */
function remoteTransport(entry: Record<string, unknown>): 'http' | 'sse' | null {
  const named = own(entry, 'type') ?? own(entry, 'transport');
  if (named === undefined) return 'http';
  if (typeof named !== 'string') return null;
  const value = named.toLowerCase();
  if (value === 'sse') return 'sse';
  if (['http', 'streamable-http', 'streamablehttp', 'streamable_http'].includes(value)) {
    return 'http';
  }
  return null;
}

/**
 * One entry in the app's shape, or null when the app cannot use it. Fields that the app does
 * not use (`disabled`, `autoApprove`, `timeout`, `toolExposure`, `exposure`, `cwd`, `trust`…)
 * are dropped; `disabled: true` is ignored (D18).
 */
function adapt(name: string, entry: unknown, adapter: Adapter): ImportedServer | null {
  if (!isObject(entry)) return null;
  const command = own(entry, 'command');
  if (command !== undefined) {
    if (typeof command !== 'string') return null;
    const rawArgs = own(entry, 'args') ?? [];
    if (!Array.isArray(rawArgs) || !rawArgs.every((arg) => typeof arg === 'string')) return null;
    const env = textRecord(own(entry, 'env'));
    if (!env) return null;
    return { name, transport: 'stdio', command, args: rawArgs as string[], env };
  }

  let url: unknown;
  let transport: 'http' | 'sse' | null;
  if (adapter === 'gemini') {
    // Gemini: `httpUrl` is Streamable HTTP, `url` is SSE, and there is no type key
    const httpUrl = own(entry, 'httpUrl');
    url = httpUrl ?? own(entry, 'url');
    transport = httpUrl !== undefined ? 'http' : 'sse';
  } else {
    // Old Windsurf wrote `serverUrl`
    url = own(entry, 'url') ?? (adapter === 'windsurf' ? own(entry, 'serverUrl') : undefined);
    transport = remoteTransport(entry);
  }
  if (typeof url !== 'string' || !transport) return null;
  const headers = textRecord(own(entry, 'headers'));
  if (!headers) return null;
  return { name, transport, url, headers };
}

// ─── Scan views ──────────────────────────────────────────────────────────────

/** The SEC-03 rule of the manager, as a short reason */
function urlSecurityReason(url: string): string | null {
  try {
    validateUrlSecurity(url);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : URL_NOT_VALID;
    return message.replace(/^\[MCP Security\]\s*/, '');
  }
}

const placeholderCount = (values: Iterable<string>): number => {
  let n = 0;
  for (const value of values) if (hasPlaceholder(value)) n++;
  return n;
};

/** The scan view of one server, without its key: no env value, header value, or URL query */
function viewOf(server: ImportedServer, home: string): Omit<ScannedServer, 'key'> {
  if (server.transport === 'stdio') {
    const blocked = cannotRunReason(server);
    // No host path in the scan: the list shows the ~/ form, and read returns the real command
    const command = homeForm(server.command, home);
    return {
      name: server.name,
      transport: 'stdio',
      command,
      commandKey: command,
      // Path arguments in the home folder too, after the masking
      args: homeFormArgs(maskArguments(server.args), (path) => homeForm(path, home)),
      envNames: Object.keys(server.env),
      placeholders: placeholderCount(Object.values(server.env)),
      ...(blocked && { blocked }),
    };
  }
  const blocked = cannotRunReason(server) ?? urlSecurityReason(server.url);
  return {
    name: server.name,
    transport: server.transport,
    url: stripUrl(server.url) ?? '',
    headerNames: Object.keys(server.headers),
    placeholders: placeholderCount([server.url, ...Object.values(server.headers)]),
    ...(blocked && { blocked }),
  };
}

/** Changes when what the scan showed changes; it is made from the view, so it holds no secret */
const revisionOf = (view: Omit<ScannedServer, 'key'>): string =>
  createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);

const UNREADABLE_ENTRY = 'The app cannot read this entry';

interface ParsedFile {
  file: ImportFile;
  status: ScannedFileStatus;
  /** name → the server, or null when the entry does not map */
  entries: Map<string, { server: ImportedServer | null; view: ScannedServer }>;
}

// ─── The importer ────────────────────────────────────────────────────────────

export interface MCPImporterOptions {
  /** The home folder; default `os.homedir()` (never HOME from a request) */
  home?: string;
  platform?: NodeJS.Platform;
}

export interface MCPImporter {
  scan(): Promise<MCPImportScan>;
  read(keys: readonly string[]): Promise<MCPImportRead>;
}

export function createMCPImporter(options: MCPImporterOptions = {}): MCPImporter {
  const getHome = () => options.home ?? homedir();

  async function parseAll(): Promise<ParsedFile[]> {
    const home = getHome();
    const base = home.endsWith('/') ? home : `${home}/`;
    return Promise.all(
      importFiles(options.platform).map(async (file): Promise<ParsedFile> => {
        const result = await readImportFile(base + file.path);
        const entries: ParsedFile['entries'] = new Map();
        if (result.status !== 'ok') return { file, status: result.status, entries };
        for (const name of Object.keys(result.servers)) {
          if (!isSafeServerName(name)) continue;
          const server = adapt(name, result.servers[name], file.adapter);
          const view: Omit<ScannedServer, 'key'> = server
            ? viewOf(server, home)
            : { name, transport: 'stdio', placeholders: 0, blocked: UNREADABLE_ENTRY };
          entries.set(name, {
            server,
            view: { key: readKey(file.tool, revisionOf(view), name), ...view },
          });
        }
        return { file, status: 'ok', entries };
      })
    );
  }

  return {
    async scan() {
      const parsed = await parseAll();
      const files: ScannedFile[] = parsed.map(({ file, status, entries }) => ({
        tool: file.tool,
        label: TOOL_LABEL[file.tool],
        file: `~/${file.path}`,
        status,
        servers: [...entries.values()].map((entry) => entry.view),
      }));
      // No hash when the home folder is `/`: then nothing has a ~/ form
      const prefix = homePrefix(getHome());
      return { files, ...(prefix && { homeHash: shortHash(prefix) }) };
    },

    async read(keys) {
      const parsed = await parseAll();
      const byTool = new Map(parsed.map((file) => [file.file.tool as string, file]));
      const result: MCPImportRead = { servers: [], skipped: [] };
      for (const key of new Set(keys)) {
        const parts = parseReadKey(key);
        const file = parts ? byTool.get(parts.tool) : undefined;
        const entry = parts && file ? file.entries.get(parts.name) : undefined;
        if (!parts || !entry) {
          result.skipped.push({ key, reason: 'This server is no longer in the file' });
        } else if (entry.view.key !== key) {
          result.skipped.push({
            key,
            reason: 'This server changed in the file. Open the tab again to see it.',
          });
        } else if (!entry.server || entry.view.blocked) {
          result.skipped.push({ key, reason: entry.view.blocked ?? UNREADABLE_ENTRY });
        } else {
          result.servers.push({ key, config: toServerConfig(entry.server, generateMCPServerId()) });
        }
      }
      return result;
    },
  };
}
