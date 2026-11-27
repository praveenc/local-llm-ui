/**
 * Import MCP servers from the config files of other tools (item 25, D17 to D19).
 *
 * Shared by the server (`server/mcp-import.ts`, which reads the files) and the MCP Servers tab.
 * Pure helper: no DOM and no Node imports.
 *
 * The scan shows no secret: arguments after a flag named like a key are masked, URLs lose their
 * query and user info, and env variables and headers show their names only. Only the read route
 * returns values, for the servers that the user selects.
 */
import type { MCPServerConfig, MCPServersMap, MCPTransportType } from '../types/mcp.ts';
import {
  argumentError,
  classifyCommand,
  findDisallowedArgument,
  sanitizeServerName,
} from './mcpCommand.ts';

// ─── Tools and wire types ─────────────────────────────────────────────────────

/** The tools whose files the import reads, in the fixed order: the first tool of a group wins */
export const MCP_IMPORT_TOOLS = [
  { id: 'kiro', label: 'Kiro' },
  { id: 'pi', label: 'Pi' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'devin', label: 'Devin Desktop' },
  { id: 'windsurf', label: 'Windsurf' },
] as const;

export type MCPImportToolId = (typeof MCP_IMPORT_TOOLS)[number]['id'];

const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  MCP_IMPORT_TOOLS.map((tool) => [tool.id, tool.label])
);

export const toolLabel = (id: string): string => TOOL_LABELS[id] ?? id;

/** ok: read; missing: no file; too-large: over 4 MB; unreadable: not a file or not JSON */
export type ScannedFileStatus = 'ok' | 'missing' | 'too-large' | 'unreadable';

/** One server as the scan shows it. It holds no secret value. */
export interface ScannedServer {
  /** What the read route takes: `tool:revision:name` */
  key: string;
  name: string;
  transport: MCPTransportType;
  /** Local servers: the command, with the home folder written as `~/` (no host path) */
  command?: string;
  /** Local servers: the command with the home folder written as `~/`, for "same server" */
  commandKey?: string;
  /** Local servers: the arguments, masked (`maskArguments`) */
  args?: string[];
  envNames?: string[];
  /** Remote servers: the URL without query, fragment, and user info (empty when not valid) */
  url?: string;
  headerNames?: string[];
  /** How many env values, URLs, and header values use `${…}` or `$VAR` */
  placeholders: number;
  /** Why the app cannot run this server, or absent */
  blocked?: string;
}

export interface ScannedFile {
  tool: MCPImportToolId;
  label: string;
  /** The file as `~/…` */
  file: string;
  status: ScannedFileStatus;
  servers: ScannedServer[];
}

export interface MCPImportScan {
  files: ScannedFile[];
  /**
   * `shortHash` of the home folder with a trailing `/`, so that the list can write an app
   * command in the home folder as `~/` before it compares. The scan never holds the path.
   */
  homeHash?: string;
}

export interface MCPImportRead {
  servers: Array<{ key: string; config: MCPServerConfig }>;
  skipped: Array<{ key: string; reason: string }>;
}

/** Words for a file that the scan could not use */
export const FILE_STATUS_TEXT: Record<Exclude<ScannedFileStatus, 'ok' | 'missing'>, string> = {
  'too-large': 'too large',
  unreadable: 'could not read',
};

// ─── Read keys ────────────────────────────────────────────────────────────────

export const MAX_READ_KEYS = 100;
export const MAX_READ_KEY_LENGTH = 300;
/** Longer names are left out of the scan, so that each key fits in MAX_READ_KEY_LENGTH */
export const MAX_SERVER_NAME_LENGTH = 200;

export const readKey = (tool: string, revision: string, name: string): string =>
  `${tool}:${revision}:${name}`;

/** The parts of a read key, or null. The name can hold `:`, the tool and the revision cannot. */
export function parseReadKey(key: string): { tool: string; revision: string; name: string } | null {
  const first = key.indexOf(':');
  const second = first === -1 ? -1 : key.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1 || second === key.length - 1) return null;
  return {
    tool: key.slice(0, first),
    revision: key.slice(first + 1, second),
    name: key.slice(second + 1),
  };
}

/** Server names that must not become object keys, and names that are not text */
export function isSafeServerName(name: unknown): name is string {
  if (typeof name !== 'string' || !name.trim()) return false;
  if (name === '__proto__' || name === 'constructor' || name === 'prototype') return false;
  if (name.length > MAX_SERVER_NAME_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f]/.test(name);
}

// ─── Masks ────────────────────────────────────────────────────────────────────

/** What the scan shows instead of a secret argument */
export const MASK = '••••';

const SECRET_FLAG = /key|token|secret|password/i;

// ─── Short hash ───────────────────────────────────────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a 64-bit of the UTF-16 code units, as 16 hex characters. A stable, sync, non-crypto
 * hash: what **Not now** stores, so that the preferences never hold the text of a key.
 */
export function shortHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * The command with the home folder written as `~/`, when the home folder is the one whose
 * `shortHash` the scan sent. The same form as the server's view of a file command.
 */
export function homeFormByHash(command: string, homeHash: string | undefined): string {
  const trimmed = command.trim();
  if (!homeHash || !trimmed.startsWith('/')) return trimmed;
  for (let i = trimmed.indexOf('/', 1); i !== -1; i = trimmed.indexOf('/', i + 1)) {
    if (shortHash(trimmed.slice(0, i + 1)) === homeHash) return `~/${trimmed.slice(i + 1)}`;
  }
  return trimmed;
}

/**
 * The home folder with one `/` at the end, or null when it is `/` or empty (some containers):
 * then nothing has a `~/` form, because every absolute path would get one.
 */
export function homePrefix(home: string): string | null {
  const prefix = home.endsWith('/') ? home : `${home}/`;
  return prefix === '/' ? null : prefix;
}

/** The path with the home folder written as `~/`, so that both forms compare alike */
export function homeForm(path: string, home: string): string {
  const trimmed = path.trim();
  const prefix = homePrefix(home);
  return prefix && trimmed.startsWith(prefix) ? `~/${trimmed.slice(prefix.length)}` : trimmed;
}

/**
 * The arguments with `form` applied to each argument and to the value of `--flag=value`, so
 * that a path argument in the home folder shows in its `~/` form. An argument that does not
 * start with `/` (or a value that does not) stays as it is, spaces included.
 */
export function homeFormArgs(args: readonly string[], form: (path: string) => string): string[] {
  return args.map((arg) => {
    if (arg.startsWith('/')) return form(arg);
    if (arg.startsWith('-')) {
      const eq = arg.indexOf('=');
      if (eq !== -1 && arg.startsWith('/', eq + 1)) {
        return `${arg.slice(0, eq + 1)}${form(arg.slice(eq + 1))}`;
      }
    }
    return arg;
  });
}

/** The URL without query, fragment, and user info, or null when it does not parse */
export function stripUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

const URL_START = /[a-z][a-z0-9+.-]*:\/\//i;
/**
 * User info runs from `scheme://` to the LAST `@` before a space, so a password that holds a
 * raw `/`, `?`, or `#` is cut too. An `@` in a path also cuts the host: that hides more than it
 * needs, but never shows a secret.
 */
const USER_INFO = /([a-z][a-z0-9+.-]*:\/\/)\S*@/gi;

/**
 * The text with the query, fragment, and user info cut from any `scheme://` URL in it (http,
 * https, ws, wss, or any other scheme), also when the URL is the value of `--flag=`. Everything
 * after the first `?` or `#` that follows a URL is dropped. One URL that parses is written in
 * its normal form.
 */
function stripUrlsIn(text: string): string {
  const match = URL_START.exec(text);
  if (!match) return text;
  const head = text.slice(0, match.index);
  // User info first: a `?` or `#` in a password must not end the URL before its `@`
  let rest = text.slice(match.index).replace(USER_INFO, '$1');
  const cut = rest.search(/[?#]/);
  if (cut !== -1) rest = rest.slice(0, cut);
  if (!/\s/.test(rest) && !URL_START.test(rest.slice(match[0].length))) {
    rest = stripUrl(rest) ?? rest;
  }
  return head + rest;
}

/** Flags whose next argument is `NAME=value` (Docker `-e`) */
const ENV_FLAGS = new Set(['-e', '--env']);
/** Flags whose next argument is `Name: value` (mcp-remote, curl) */
const HEADER_FLAGS = new Set(['-H', '--header']);

/** `NAME=••••`, or the text when it has no `=` (Docker then takes the value from the host) */
const maskEnvValue = (text: string): string => {
  const eq = text.indexOf('=');
  return eq === -1 ? text : `${text.slice(0, eq)}=${MASK}`;
};

/** `Name: ••••`, or the mask alone when the text has no `:` */
const maskHeaderValue = (text: string): string => {
  const colon = text.indexOf(':');
  return colon === -1 ? MASK : `${text.slice(0, colon)}: ${MASK}`;
};

/**
 * The arguments with secrets hidden:
 * - the value after a flag whose name holds key, token, secret, or password (`--api-key x`,
 *   `--api-key=x`, `-token x`);
 * - the value of `-e NAME=value` and `--env NAME=value` (the name stays);
 * - the value of `--header "Name: value"`, `--header=Name: value`, and `-H` (the name stays);
 * - the query, fragment, and user info of any `scheme://` URL, also after `--flag=`.
 * Masking a masked list changes nothing.
 */
export function maskArguments(args: readonly string[]): string[] {
  const out: string[] = [];
  let next: 'secret' | 'env' | 'header' | null = null;
  for (const arg of args) {
    if (next) {
      out.push(
        next === 'secret' ? MASK : next === 'env' ? maskEnvValue(arg) : maskHeaderValue(arg)
      );
      next = null;
      continue;
    }
    if (arg.startsWith('-')) {
      const eq = arg.indexOf('=');
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      const value = eq === -1 ? null : arg.slice(eq + 1);
      if (SECRET_FLAG.test(flag)) {
        if (value === null) next = 'secret';
        out.push(value === null ? arg : `${flag}=${MASK}`);
        continue;
      }
      if (ENV_FLAGS.has(flag)) {
        if (value === null) next = 'env';
        out.push(value === null ? arg : `${flag}=${maskEnvValue(value)}`);
        continue;
      }
      if (HEADER_FLAGS.has(flag)) {
        if (value === null) next = 'header';
        out.push(value === null ? arg : `${flag}=${maskHeaderValue(value)}`);
        continue;
      }
    }
    out.push(stripUrlsIn(arg));
  }
  return out;
}

// ─── Placeholders and "cannot run" ────────────────────────────────────────────

/** `${…}` (Kiro, Cursor, Gemini) or `$VAR` (Gemini) */
const PLACEHOLDER = /\$\{[^}]*\}|\$[A-Za-z_]/;

export const hasPlaceholder = (value: string): boolean => PLACEHOLDER.test(value);

export const PLACEHOLDER_COMMAND_ERROR =
  'The command or an argument uses ${…} or $VAR. The app does not expand them.';

export const URL_NOT_VALID = 'The URL is not valid';

/** The fields of a server that the checks need. Both scanned and full servers have them. */
export interface ImportServerShape {
  transport: MCPTransportType;
  command?: string;
  args?: readonly string[];
  url?: string;
}

/**
 * Why the app cannot run a server as it is in the file, or null: a command shape that the app
 * refuses, `${…}` or `$VAR` in the command or an argument, an argument with shell characters,
 * or a URL that does not parse. The server adds the SEC-03 URL rule.
 */
export function cannotRunReason(server: ImportServerShape): string | null {
  if (server.transport === 'stdio') {
    const command = server.command ?? '';
    const args = server.args ?? [];
    if (hasPlaceholder(command) || args.some(hasPlaceholder)) return PLACEHOLDER_COMMAND_ERROR;
    const shape = classifyCommand(command);
    if (shape.kind === 'invalid') return shape.error;
    const bad = findDisallowedArgument(args);
    return bad === null ? null : argumentError(bad);
  }
  const url = server.url?.trim() ?? '';
  if (!url || stripUrl(url) === null) return URL_NOT_VALID;
  const protocol = new URL(url).protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return 'Only http and https URLs work';
  return null;
}

/** The note for values that use `${…}`, or null */
export function placeholderNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 value uses ${…}. The app passes it as text. Type the real value after the import.'
    : `${count} values use \${…}. The app passes them as text. Type the real values after the import.`;
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

/** One server from a file, with its values: what the server's adapters return */
export type ImportedServer =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      headers: Record<string, string>;
    };

/** The app's config for one imported server. It is off (D18). */
export function toServerConfig(server: ImportedServer, id: string): MCPServerConfig {
  if (server.transport === 'stdio') {
    return {
      id,
      name: server.name,
      enabled: false,
      transport: 'stdio',
      command: server.command.trim(),
      args: [...server.args],
      env: { ...server.env },
    };
  }
  return {
    id,
    name: server.name,
    enabled: false,
    transport: server.transport,
    url: server.url.trim(),
    headers: { ...server.headers },
  };
}

// ─── Same server ──────────────────────────────────────────────────────────────

/** The fields that decide "same server" */
export interface SameServerShape {
  transport: MCPTransportType;
  command?: string;
  commandKey?: string;
  args?: readonly string[];
  url?: string;
}

/**
 * Two servers are the same when they have the same command and the same arguments in order
 * (arguments compared masked, so a scanned and a full server compare alike), or the same
 * transport and URL (without query and user info). Env and headers do not count.
 */
export function sameServerKey(server: SameServerShape): string {
  if (server.transport === 'stdio') {
    const command = (server.commandKey ?? server.command ?? '').trim();
    return JSON.stringify(['stdio', command, maskArguments(server.args ?? [])]);
  }
  const url = server.url ?? '';
  return JSON.stringify([server.transport, stripUrl(url) ?? url.trim()]);
}

// ─── The list ─────────────────────────────────────────────────────────────────

export type ImportRowState = 'importable' | 'added' | 'blocked';

/** One row of the import list: the same server from one or more tools */
export interface ImportRow {
  sameKey: string;
  /** `shortHash(sameKey)`: what **Not now** stores */
  dismissKey: string;
  /** The read key of the first tool in the fixed order */
  key: string;
  tool: MCPImportToolId;
  /** Every tool that has the server, in the fixed order */
  tools: MCPImportToolId[];
  server: ScannedServer;
  state: ImportRowState;
  /** Why it cannot run (state 'blocked') */
  reason?: string;
  /** The name that the app gives it: the name, or "name (Tool)" when the name is used */
  importName: string;
  note: string | null;
}

/** "Kiro", "Kiro and Pi", "Kiro, Pi, and Cursor" */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

const TOOL_ORDER: readonly string[] = MCP_IMPORT_TOOLS.map((tool) => tool.id);

/**
 * The rows of the import list, in the fixed tool order: one row per "same server", against the
 * app's servers (disabled ones count as added). An importable row whose sanitized name is used
 * by the app or by an earlier row gets " (Tool)" after it.
 */
export function buildImportRows(scan: MCPImportScan, appServers: MCPServersMap): ImportRow[] {
  const files = [...scan.files]
    .filter((file) => file.status === 'ok')
    .sort((a, b) => TOOL_ORDER.indexOf(a.tool) - TOOL_ORDER.indexOf(b.tool));

  const groups = new Map<
    string,
    { tool: MCPImportToolId; tools: MCPImportToolId[]; server: ScannedServer }
  >();
  for (const file of files) {
    for (const server of file.servers) {
      const key = groupKey(file.tool, server);
      const group = groups.get(key);
      if (!group) groups.set(key, { tool: file.tool, tools: [file.tool], server });
      else if (!group.tools.includes(file.tool)) group.tools.push(file.tool);
    }
  }

  const app = Object.values(appServers);
  // The app command in the ~/ form, as the file side has it
  const added = new Set(
    app.map((server) =>
      sameServerKey(
        server.transport === 'stdio'
          ? {
              ...server,
              commandKey: homeFormByHash(server.command, scan.homeHash),
              args: homeFormArgs(server.args ?? [], (path) => homeFormByHash(path, scan.homeHash)),
            }
          : server
      )
    )
  );
  const usedNames = new Set(app.map((server) => sanitizeServerName(server.name)));

  const rows: ImportRow[] = [];
  for (const [sameKey, group] of groups) {
    const { server } = group;
    const reason = server.blocked ?? cannotRunReason(server) ?? undefined;
    const state: ImportRowState = added.has(sameKey) ? 'added' : reason ? 'blocked' : 'importable';
    let importName = server.name;
    if (state === 'importable') {
      importName = uniqueName(server.name, toolLabel(group.tool), usedNames);
      usedNames.add(sanitizeServerName(importName));
    }
    rows.push({
      sameKey,
      dismissKey: shortHash(sameKey),
      key: server.key,
      tool: group.tool,
      tools: group.tools,
      server,
      state,
      ...(state === 'blocked' && { reason }),
      importName,
      note: placeholderNote(server.placeholders),
    });
  }
  return rows;
}

/**
 * The "same server" key, or for an entry with no command or no URL that parses, a key of its
 * own (tool and name), so that broken entries do not merge into one row.
 */
function groupKey(tool: MCPImportToolId, server: ScannedServer): string {
  const empty =
    server.transport === 'stdio'
      ? !(server.commandKey ?? server.command ?? '').trim()
      : stripUrl(server.url ?? '') === null;
  return empty ? JSON.stringify(['entry', tool, server.name]) : sameServerKey(server);
}

function uniqueName(name: string, label: string, used: ReadonlySet<string>): string {
  if (!used.has(sanitizeServerName(name))) return name;
  const base = `${name} (${label})`;
  if (!used.has(sanitizeServerName(base))) return base;
  for (let n = 2; ; n++) {
    const next = `${base} ${n}`;
    if (!used.has(sanitizeServerName(next))) return next;
  }
}

/** The rows that the user can import */
export const importableRows = (rows: readonly ImportRow[]): ImportRow[] =>
  rows.filter((row) => row.state === 'importable');

/** The importable rows whose key "Not now" did not store (hashes, `dismissKey`) */
export function newImportRows(
  rows: readonly ImportRow[],
  dismissed: readonly string[] = []
): ImportRow[] {
  const seen = new Set(dismissed);
  return importableRows(rows).filter((row) => !seen.has(row.dismissKey));
}

/** True when an importable row has a key that "Not now" did not store */
export function hasNewImports(rows: readonly ImportRow[], dismissed: readonly string[]): boolean {
  return newImportRows(rows, dismissed).length > 0;
}

/**
 * "12 servers in Kiro and Pi are not in this app". It counts only the rows that "Not now" did not
 * hide, and names only their tools.
 */
export function importLineText(
  rows: readonly ImportRow[],
  dismissed: readonly string[] = []
): string {
  const importable = newImportRows(rows, dismissed);
  const tools = TOOL_ORDER.filter((id) =>
    importable.some((row) => row.tools.includes(id as MCPImportToolId))
  );
  const where = joinLabels(tools.map(toolLabel));
  const n = importable.length;
  return n === 1
    ? `1 server in ${where} is not in this app`
    : `${n} servers in ${where} are not in this app`;
}

/** "Found in Kiro and Pi", for a row that more than one tool has */
export function foundInText(row: ImportRow): string | null {
  return row.tools.length > 1 ? `Found in ${joinLabels(row.tools.map(toolLabel))}` : null;
}
