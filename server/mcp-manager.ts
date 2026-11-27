/**
 * MCP Client Manager — creates, caches, and exposes MCP tools for streamText().
 *
 * Manages MCP client lifecycle with config-based caching. Clients are reused
 * when their config hasn't changed and recreated when it has.
 *
 * Security hardening (SEC-01 through SEC-11):
 * - Stdio command: a program name found on the child's PATH, or a full path that
 *   starts with / or ~/, checked and resolved before the start; the resolved path is
 *   spawned with no shell; arguments with shell characters are refused (SEC-01)
 * - Safe env var allowlist — no process.env leak (SEC-02)
 * - SSRF protection for HTTP/SSE URLs (SEC-03)
 * - Connection timeout on client creation (SEC-10)
 * - Runtime validation of MCP config structure (SEC-11)
 *
 * Lifecycle: one start for each server at a time, a timeout that closes the
 * process, the end of the child's error output in the error text, and removal
 * from the cache when a stdio process stops (the next call starts it again).
 */
import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import type {
  MCPHTTPConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPStdioConfig,
} from '../src/types/mcp.ts';
import { argumentError, classifyCommand, findDisallowedArgument } from '../src/utils/mcpCommand.ts';
import { resolveCommand } from './mcp-command.ts';

/** Separator used to namespace tool names: serverName__toolName */
const TOOL_NS_SEP = '__';

/** SEC-10: Connection timeout for MCP client creation and the tool listing (ms) */
const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 15_000;
let MCP_CONNECT_TIMEOUT_MS = DEFAULT_MCP_CONNECT_TIMEOUT_MS;

/** Test only: set a shorter connect timeout. No argument restores the default. */
export function setMCPConnectTimeoutForTests(ms: number = DEFAULT_MCP_CONNECT_TIMEOUT_MS): void {
  MCP_CONNECT_TIMEOUT_MS = ms;
}

// ─── Security: Stdio command and arguments (SEC-01) ──────────────────────────

/**
 * SEC-01: The static checks of a stdio config, before the hash and before any start: the
 * shape of the command (a name, or a path that starts with / or ~/) and the arguments.
 * The program itself is found in createClient (`resolveCommand`). The texts never show an
 * argument: it can hold a secret.
 */
function validateStdioSecurity(config: MCPStdioConfig): void {
  const shape = classifyCommand(config.command);
  if (shape.kind === 'invalid') throw new Error(shape.error);

  const badArgument = findDisallowedArgument(config.args);
  if (badArgument !== null) throw new Error(argumentError(badArgument));
}

// ─── Security: Safe Environment Variables (SEC-02) ───────────────────────────

/**
 * SEC-02: Only these env vars are inherited from process.env.
 * AWS credentials, API keys, and other secrets are NOT passed to MCP children.
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'NODE_ENV',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
];

function getSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) safe[key] = process.env[key]!;
  }
  return safe;
}

// ─── Security: SSRF Protection (SEC-03) ──────────────────────────────────────

/**
 * SEC-03: Validate HTTP/SSE URLs to prevent SSRF attacks.
 * Blocks cloud metadata endpoints, private IPs, and localhost.
 */
function validateUrlSecurity(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    // Nothing in a string that does not parse is safe to show: it can hold a token
    throw new Error('[MCP Security] The URL is not valid');
  }

  // Only allow http/https schemes
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`[MCP Security] Only http/https URLs are allowed, got: '${url.protocol}'`);
  }

  const hostname = url.hostname.toLowerCase();

  // Block cloud metadata endpoints (AWS, GCP, Azure)
  const metadataHosts = ['169.254.169.254', '169.254.170.2', 'metadata.google.internal'];
  if (metadataHosts.includes(hostname)) {
    throw new Error(`[MCP Security] Cloud metadata endpoints are blocked: '${hostname}'`);
  }

  // Block localhost and loopback
  if (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname === '127.0.0.1'
  ) {
    throw new Error(
      `[MCP Security] Localhost URLs are not allowed for remote MCP servers: '${hostname}'`
    );
  }

  // Block private IP ranges (RFC 1918 + link-local)
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) // 169.254.0.0/16 (link-local)
    ) {
      throw new Error(`[MCP Security] Private IP addresses are blocked: '${hostname}'`);
    }
  }
}

// ─── Security: Runtime Config Validation (SEC-11) ────────────────────────────

/**
 * SEC-11: Validate MCP config structure at runtime.
 * TypeScript types only provide compile-time safety; this catches malformed
 * configs from the request body.
 */
function validateConfigStructure(config: unknown): config is MCPServerConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;

  if (typeof c.id !== 'string' || !c.id) return false;
  if (typeof c.name !== 'string' || !c.name) return false;
  if (!['stdio', 'http', 'sse'].includes(c.transport as string)) return false;

  switch (c.transport) {
    case 'stdio':
      if (typeof c.command !== 'string' || !c.command) return false;
      if (!Array.isArray(c.args) || !c.args.every((a: unknown) => typeof a === 'string'))
        return false;
      if (c.env !== undefined && (typeof c.env !== 'object' || c.env === null)) return false;
      break;
    case 'http':
    case 'sse':
      if (typeof c.url !== 'string' || !c.url) return false;
      if (c.headers !== undefined && (typeof c.headers !== 'object' || c.headers === null))
        return false;
      break;
  }

  return true;
}

/**
 * Validate a single MCP config — structure, security, and transport-specific rules.
 * Throws descriptive errors on failure.
 */
function validateMCPConfig(config: unknown): asserts config is MCPServerConfig {
  if (!validateConfigStructure(config)) {
    // Name and id only: the config can hold environment values and headers (secrets)
    const c = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const name = typeof c.name === 'string' ? c.name.slice(0, 100) : '';
    const id = typeof c.id === 'string' ? c.id.slice(0, 100) : '';
    throw new Error(`[MCP Security] Invalid MCP config for server "${name}" (${id})`);
  }

  // Transport-specific security validation
  switch (config.transport) {
    case 'stdio':
      validateStdioSecurity(config as MCPStdioConfig);
      break;
    case 'http':
    case 'sse':
      validateUrlSecurity((config as MCPHTTPConfig | MCPSSEConfig).url);
      break;
  }
}

// ─── Child process output (stdio) ────────────────────────────────────────────

/** How much of a child's error output to keep (bytes) */
const STDERR_TAIL_BYTES = 4096;
/** The error text shows at most this many lines and characters of that output */
const OUTPUT_MAX_LINES = 6;
const OUTPUT_MAX_CHARS = 400;
/** The server name in front of each terminal line is cut to this length */
const TERMINAL_NAME_MAX_CHARS = 60;
/** A child that ignores SIGTERM after a close gets SIGKILL after this time (ms) */
const DEFAULT_KILL_GRACE_MS = 2000;
let KILL_GRACE_MS = DEFAULT_KILL_GRACE_MS;

/** Test only: set a shorter SIGKILL grace time. No argument restores the default. */
export function setMCPKillGraceForTests(ms: number = DEFAULT_KILL_GRACE_MS): void {
  KILL_GRACE_MS = ms;
}

const TRANSPORT_CHANGED_MESSAGE =
  'The AI SDK stdio transport changed: the error output of MCP servers cannot be read.';
let warnedTransportChanged = false;

// ANSI escape sequences: CSI, OSC, and the short two-character forms
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\x00-\x1f\x7f-\x9f]/g;

/** The end of a child's error output as one short line for the error text */
function summarizeOutput(raw: string): string {
  const lines = raw
    .replace(ANSI_PATTERN, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-OUTPUT_MAX_LINES);
  const text = lines.join(' ');
  if (text.length <= OUTPUT_MAX_CHARS) return text;
  return `${text.slice(0, OUTPUT_MAX_CHARS - 1).trimEnd()}…`;
}

/** The name comes from the browser: no control characters, so it cannot forge terminal lines */
function terminalName(name: string): string {
  return name.replace(CONTROL_PATTERN, ' ').slice(0, TERMINAL_NAME_MAX_CHARS);
}

/** How a stdio child stopped */
interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True when the child stopped before the app closed it */
  onItsOwn: boolean;
}

/**
 * Stdio transport that waits for the `server/discover` answer, and keeps the
 * end of the child's error output.
 *
 * The AI SDK waits only 1 s for that answer on stdio. Then it falls back to the
 * `initialize` handshake. A server that starts in more than 1 s (for example, `uvx`
 * on a slow machine or on its first run) has already selected the 2026-07-28 protocol
 * from the first request, so it rejects `initialize`: "connection is serving the
 * 2026-07-28 protocol; the initialize handshake is not accepted". The SDK waits like
 * this for Streamable HTTP. Legacy servers answer the unknown method with an error,
 * and the client then falls back to `initialize`. MCP_CONNECT_TIMEOUT_MS limits the wait.
 *
 * The SDK spawns the child with `stderr: 'inherit'` by default, so the reason for a
 * failed start (for example `npm error code E401`) reaches only the terminal. This
 * transport spawns with `stderr: 'pipe'`, keeps the last 4 KB, and copies each line
 * to the dev server's stderr with the server name in front.
 *
 * Limit: the SDK spawns without a process group, so a close stops the direct child
 * only. A wrapper such as `npm exec` forwards the SIGTERM to the server it started; a
 * wrapper that does not forward it leaves that server running.
 */
class DiscoveryWaitingStdioTransport extends Experimental_StdioMCPTransport {
  readonly waitsForProtocolVersionDiscovery = true;

  /** Set when the child stops; undefined while it runs or before it starts */
  exit: ChildExit | undefined;
  /** Called once when the child stops on its own after the client connected */
  onProcessExit: (() => void) | undefined;

  private readonly serverName: string;
  private stderrTail = Buffer.alloc(0);
  /** Decodes the terminal copy, so a character split across two chunks stays whole */
  private readonly decoder = new StringDecoder('utf8');
  private partialLine = '';
  private child: ChildProcess | undefined;
  private closing = false;

  constructor(
    params: ConstructorParameters<typeof Experimental_StdioMCPTransport>[0],
    serverName: string
  ) {
    super({ ...params, stderr: 'pipe' });
    this.serverName = terminalName(serverName);
  }

  override async start(): Promise<void> {
    await super.start();
    // The SDK keeps the child in a `private process` field (no getter), and clears it
    // on close. This is the only read of it: once, right after the spawn.
    const child = (this as unknown as { process?: ChildProcess }).process;
    if (!child) {
      // Nobody would read the stderr pipe, and a server that writes a lot would block
      // on it. So stop the child and say why, instead of running it half watched.
      if (!warnedTransportChanged) {
        warnedTransportChanged = true;
        console.warn(`[MCP Manager] ${TRANSPORT_CHANGED_MESSAGE}`);
      }
      await this.close();
      throw new Error(TRANSPORT_CHANGED_MESSAGE);
    }
    this.child = child;
    // Read the pipe always, so a server that writes a lot cannot block on it
    child.stderr?.on('data', (chunk: Buffer) => this.onStderr(chunk));
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this.partialLine += this.decoder.end();
      this.flushLine();
      this.exit = { code, signal, onItsOwn: !this.closing };
      if (!this.closing) this.onProcessExit?.();
    });
  }

  override async close(): Promise<void> {
    this.closing = true;
    const child = this.child;
    await super.close();
    if (child && !this.exit) {
      const timer = setTimeout(() => {
        if (!this.exit) child.kill('SIGKILL');
      }, KILL_GRACE_MS);
      timer.unref();
      child.once('close', () => clearTimeout(timer));
    }
  }

  /** The end of the error output as one short line, or '' */
  outputSummary(): string {
    return summarizeOutput(this.stderrTail.toString('utf8'));
  }

  private onStderr(chunk: Buffer): void {
    const joined = Buffer.concat([this.stderrTail, chunk]);
    this.stderrTail = joined.subarray(Math.max(0, joined.length - STDERR_TAIL_BYTES));

    const lines = (this.partialLine + this.decoder.write(chunk)).split('\n');
    this.partialLine = lines.pop() ?? '';
    for (const line of lines) this.writeLine(line);
    // A server that never ends a line still shows in the terminal
    if (this.partialLine.length > STDERR_TAIL_BYTES) this.flushLine();
  }

  private flushLine(): void {
    if (this.partialLine) this.writeLine(this.partialLine);
    this.partialLine = '';
  }

  private writeLine(line: string): void {
    process.stderr.write(`[MCP ${this.serverName}] ${line.replace(/\r$/, '')}\n`);
  }
}

// ─── Error text ──────────────────────────────────────────────────────────────

function formatSeconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))} s`;
}

/**
 * Errors from Node internals can come from another realm (for example under a test
 * runner's VM context), where `instanceof Error` is false. So read fields, not the class.
 */
function errorField(error: unknown, field: 'message' | 'code' | 'syscall'): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function isTimeoutError(error: unknown): boolean {
  return /^(MCP client initialization timed out|Request timed out) after \d+ms$/.test(
    errorField(error, 'message') ?? ''
  );
}

/** True when the error, or an error in its `cause` chain, has this Node error code */
function hasErrorCode(error: unknown, code: string): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    if (errorField(e, 'code') === code) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Node error codes of a spawn that found the file but could not run it */
const SPAWN_ERROR_CODES = ['EACCES', 'ENOEXEC', 'EISDIR', 'ENOTDIR', 'ELOOP', 'EPERM'];

/** True when the error, or an error in its `cause` chain, comes from the spawn of the child */
function isSpawnError(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    if (errorField(e, 'syscall')?.startsWith('spawn')) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return SPAWN_ERROR_CODES.some((code) => hasErrorCode(error, code));
}

/**
 * Turn a failed start or tool listing into text that says what happened, with the
 * end of the child's error output when there is some.
 */
function describeFailure(
  error: unknown,
  config: MCPServerConfig,
  transport: DiscoveryWaitingStdioTransport | undefined,
  phase: 'start' | 'listing' = 'start'
): Error {
  const output = transport?.outputSummary() ?? '';
  const lastOutput = output ? ` Last output: ${output}` : '';

  if (isTimeoutError(error)) {
    const what = phase === 'listing' ? 'did not list its tools' : 'did not answer';
    return new Error(
      `The server ${what} in ${formatSeconds(MCP_CONNECT_TIMEOUT_MS)}.${lastOutput}`,
      { cause: error }
    );
  }
  if (config.transport === 'stdio' && hasErrorCode(error, 'ENOENT')) {
    // The file went away after the check, or a script's `#!` program is missing
    return new Error(`Command not found: ${config.command.trim()}`, { cause: error });
  }
  if (config.transport === 'stdio' && isSpawnError(error)) {
    // The transport spawns the resolved host path, and Node's text names it (for example
    // `spawn /home/user/.local/bin/x EACCES` when the mode changed after the check). Show
    // the command as the user typed it, never the path that the server found.
    return new Error(`${config.command.trim()} is not a program`, { cause: error });
  }
  const exit = transport?.exit;
  if (exit?.onItsOwn) {
    const how = exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`;
    return new Error(
      output
        ? `The server stopped before it answered (${how}): ${output}`
        : `The server stopped before it answered (${how}). It wrote no error output.`,
      { cause: error }
    );
  }
  const message = errorField(error, 'message') ?? String(error);
  return new Error(`${message}${lastOutput}`, { cause: error });
}

// ─── Client Caching ──────────────────────────────────────────────────────────

/** A connected client, with its stdio transport when it has one */
interface CachedClient {
  client: MCPClient;
  configHash: string;
  transport: DiscoveryWaitingStdioTransport | undefined;
  /** Order of the starts: a slow, older start must not replace a newer client */
  seq: number;
  /** Tool listings and chats that use this client now. A cleanup does not close it then. */
  leases: number;
  /** True when the app closed this client (not when its process stopped on its own) */
  closedByApp: boolean;
}

/** Global client cache keyed by server ID */
const clientCache = new Map<string, CachedClient>();

/** A start in progress. A second call with the same id and hash waits for it. */
interface StartInProgress {
  id: string;
  promise: Promise<CachedClient>;
}

/** Starts in progress, keyed by server ID and config hash (see startKey) */
const startsInProgress = new Map<string, StartInProgress>();

let startSeq = 0;

const startKey = (id: string, configHash: string) => `${id}\0${configHash}`;

function hasStartInProgress(id: string): boolean {
  for (const start of startsInProgress.values()) {
    if (start.id === id) return true;
  }
  return false;
}

/**
 * Compute a simple hash string from the transport-relevant parts of a config.
 * Used to detect config changes and invalidate cached clients.
 */
function computeConfigHash(config: MCPServerConfig): string {
  const parts: string[] = [config.id, config.transport];
  switch (config.transport) {
    case 'stdio':
      parts.push(config.command.trim(), ...config.args, JSON.stringify(config.env));
      break;
    case 'sse':
    case 'http':
      parts.push(config.url, JSON.stringify(config.headers ?? {}));
      break;
  }
  return parts.join('|');
}

/**
 * Remove a client from the cache (only if it is still the cached one) and close it.
 * `byApp` is false when the client goes because its process stopped on its own.
 */
async function dropClient(id: string, entry: CachedClient, byApp = true): Promise<void> {
  if (byApp) entry.closedByApp = true;
  if (clientCache.get(id) === entry) clientCache.delete(id);
  try {
    await entry.client.close();
  } catch {
    // Ignore close errors
  }
}

/**
 * Close the cached clients whose id is not in `keepIds`. A client that is in use, or
 * whose server has a start in progress, stays: its caller still needs it.
 */
async function closeClientsExcept(keepIds: Set<string>): Promise<void> {
  const stale = [...clientCache.entries()].filter(
    ([id, entry]) => !keepIds.has(id) && entry.leases === 0 && !hasStartInProgress(id)
  );
  await Promise.allSettled(stale.map(([id, entry]) => dropClient(id, entry)));
}

/**
 * Create an MCP client for the given server config.
 * getOrCreateClient validates the config first. SEC-10: the SDK's
 * `initializationOptions.timeout` limits the start, and on any failure it closes
 * the transport, which ends the child process.
 */
async function createClient(config: MCPServerConfig, configHash: string): Promise<CachedClient> {
  const initializationOptions = { timeout: MCP_CONNECT_TIMEOUT_MS };
  const seq = ++startSeq;

  switch (config.transport) {
    case 'stdio': {
      const stdioConfig = config as MCPStdioConfig;
      // The same env that the child gets: the lookup uses its PATH, and the resolved path is
      // spawned, so the file that was checked is the file that runs
      const env = { ...getSafeEnv(), ...stdioConfig.env };
      const program = await resolveCommand(stdioConfig.command, env);
      const transport = new DiscoveryWaitingStdioTransport(
        { command: program, args: stdioConfig.args, env },
        config.name
      );
      let client: MCPClient;
      try {
        client = await createMCPClient({ transport, initializationOptions });
      } catch (error) {
        throw describeFailure(error, config, transport);
      }
      const entry: CachedClient = {
        client,
        configHash,
        transport,
        seq,
        leases: 0,
        closedByApp: false,
      };
      transport.onProcessExit = () => {
        void dropClient(config.id, entry, false);
      };
      return entry;
    }
    case 'sse':
    case 'http': {
      const remote = config as MCPHTTPConfig | MCPSSEConfig;
      try {
        const client = await createMCPClient({
          transport: { type: remote.transport, url: remote.url, headers: remote.headers },
          initializationOptions,
        });
        return { client, configHash, transport: undefined, seq, leases: 0, closedByApp: false };
      } catch (error) {
        throw describeFailure(error, config, undefined);
      }
    }
  }
}

const SETTINGS_CHANGED_MESSAGE = 'The server settings changed while it started.';

/** Start a client, and put it in the cache unless a newer start already did */
async function startClient(config: MCPServerConfig, configHash: string): Promise<CachedClient> {
  const entry = await createClient(config, configHash);

  // A stdio child that stopped between the connect and now
  if (entry.transport?.exit) {
    await dropClient(config.id, entry, false);
    throw describeFailure(new Error('Connection closed'), config, entry.transport);
  }

  const current = clientCache.get(config.id);
  if (current && current.seq > entry.seq) {
    // A start with newer settings won the race: this client is stale
    await dropClient(config.id, entry);
    throw new Error(SETTINGS_CHANGED_MESSAGE);
  }
  clientCache.set(config.id, entry);
  // Config changed — close the old client now that the new one runs
  if (current) await dropClient(config.id, current);
  return entry;
}

/** A client for one caller, with a lease that keeps a cleanup from closing it */
interface LeasedClient {
  entry: CachedClient;
  /** False when the client came from the cache, true when this call waited for a start */
  fresh: boolean;
}

/**
 * Get or create a cached MCP client for the given config, and take a lease on it.
 * Closes and replaces the client if the config has changed.
 * One start runs for each server and config at a time.
 */
async function getOrCreateClient(config: MCPServerConfig): Promise<LeasedClient> {
  // SEC-01/02/03/11: Validate before the hash and before any start
  validateMCPConfig(config);
  const hash = computeConfigHash(config);
  const cached = clientCache.get(config.id);

  if (cached && cached.configHash === hash && !cached.transport?.exit) {
    cached.leases++;
    return { entry: cached, fresh: false };
  }

  const key = startKey(config.id, hash);
  const pending = startsInProgress.get(key);
  if (pending) {
    const entry = await pending.promise;
    entry.leases++;
    return { entry, fresh: true };
  }

  const start: StartInProgress = { id: config.id, promise: startClient(config, hash) };
  startsInProgress.set(key, start);
  try {
    const entry = await start.promise;
    // Taken before the start leaves the map, so no cleanup sees the client unused
    entry.leases++;
    return { entry, fresh: true };
  } finally {
    if (startsInProgress.get(key) === start) startsInProgress.delete(key);
  }
}

type MCPToolSet = ReturnType<MCPClient['toolsFromDefinitions']>;

/** The tools of one server, and the lease on its client */
interface ListedTools {
  tools: MCPToolSet;
  /** Ends the lease. A second call does nothing. */
  release: () => void;
}

function leaseRelease(entry: CachedClient): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.leases--;
  };
}

/** List the tools of one connected client, within the same timeout as the start */
async function listToolsOf(entry: CachedClient): Promise<MCPToolSet> {
  const deadline = Date.now() + MCP_CONNECT_TIMEOUT_MS;
  const timeout = () => Math.max(1, deadline - Date.now());
  let definitions = await entry.client.listTools({ options: { timeout: timeout() } });
  const tools = [...definitions.tools];
  while (definitions.nextCursor != null) {
    definitions = await entry.client.listTools({
      params: { cursor: definitions.nextCursor },
      options: { timeout: timeout() },
    });
    tools.push(...definitions.tools);
  }
  return entry.client.toolsFromDefinitions({ ...definitions, tools });
}

/**
 * Connect to a server and list its tools. The caller keeps the lease on the client
 * until it calls `release`. A timeout in the listing closes the client and removes it
 * from the cache, so no process stays.
 *
 * The listing starts the server once more when the client came from the cache (its
 * process can have stopped since), or when another path closed the client while it
 * listed. A new start that fails is reported, so a broken server cannot loop.
 */
async function listServerTools(config: MCPServerConfig, retried = false): Promise<ListedTools> {
  const { entry, fresh } = await getOrCreateClient(config);
  const release = leaseRelease(entry);
  try {
    return { tools: await listToolsOf(entry), release };
  } catch (error) {
    release();
    if (isTimeoutError(error)) {
      await dropClient(config.id, entry);
      throw describeFailure(error, config, entry.transport, 'listing');
    }
    if (!retried && (!fresh || entry.closedByApp)) {
      await dropClient(config.id, entry);
      // Newer settings replaced this client: a start with these would undo them
      const hash = computeConfigHash(config);
      const cached = clientCache.get(config.id);
      if (cached && cached.configHash !== hash) {
        throw new Error(SETTINGS_CHANGED_MESSAGE, { cause: error });
      }
      return listServerTools(config, true);
    }
    throw describeFailure(error, config, entry.transport, 'listing');
  }
}

/**
 * Given an array of MCP server configs, create clients and collect all their tools.
 * Returns a merged tools object compatible with `streamText({ tools: ... })`.
 *
 * Tools are namespaced as `serverName__toolName` to avoid collisions.
 * If a server fails to connect, it is skipped with a warning logged.
 *
 * @param configs - Array of enabled MCP server configurations
 * @returns Object with `tools` record and `cleanup` function
 */
export async function getMCPTools(
  configs: MCPServerConfig[]
): Promise<{ tools: Record<string, unknown>; cleanup: () => Promise<void> }> {
  const tools: Record<string, unknown> = {};
  const activeIds = new Set<string>();
  const releases: Array<() => void> = [];

  // Connect to each server and gather tools in parallel
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const listed = await listServerTools(config);
      return { config, listed };
    })
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const { config, listed } = result.value;
      activeIds.add(config.id);
      // The chat keeps its clients until its cleanup: another cleanup must not close them
      releases.push(listed.release);

      // Namespace each tool with the server name
      const prefix = sanitizeName(config.name);
      for (const [toolName, tool] of Object.entries(listed.tools)) {
        tools[`${prefix}${TOOL_NS_SEP}${toolName}`] = tool;
      }
    } else {
      const reason: unknown = result.reason;
      const message = errorField(reason, 'message') ?? String(reason);
      console.warn(
        `[MCP Manager] Failed to connect to MCP server "${String(configs[i]?.name)}": ${message}`
      );
    }
  });

  /**
   * Cleanup function: end this chat's leases, and close clients that are no longer in
   * the active config set. Cached clients that are still active are kept for reuse.
   */
  const cleanup = async () => {
    for (const release of releases) release();
    await closeClientsExcept(activeIds);
  };

  return { tools, cleanup };
}

export interface MCPServerStatusOptions {
  /**
   * True when `configs` is the full set of servers that the app can use: after the
   * check, close every other cached client (the same rule as the chat cleanup).
   */
  closeOthers?: boolean;
}

/**
 * Check connectivity and list tools for each MCP server config.
 * Returns per-server status (connected/error) and tool names.
 * A config with `enabled === false` is closed after its check: nothing else uses it.
 */
export async function getMCPServerStatus(
  configs: MCPServerConfig[],
  options: MCPServerStatusOptions = {}
): Promise<
  Array<{
    name: string;
    id: string;
    status: 'connected' | 'error';
    tools: string[];
    error?: string;
  }>
> {
  if (!configs) configs = [];

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const { tools, release } = await listServerTools(config);
      release();
      return {
        name: config.name,
        id: config.id,
        status: 'connected' as const,
        tools: Object.keys(tools),
      };
    })
  );

  const disabled = configs.filter((config) => config?.enabled === false);
  await Promise.allSettled(
    disabled.map((config) => {
      const entry = clientCache.get(config.id);
      return entry && entry.leases === 0 ? dropClient(config.id, entry) : undefined;
    })
  );
  if (options.closeOthers) {
    await closeClientsExcept(
      new Set(
        configs.map((config) => config?.id).filter((id): id is string => typeof id === 'string')
      )
    );
  }

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const err = result.reason as Error;
    return {
      name: configs[i].name,
      id: configs[i].id,
      status: 'error' as const,
      tools: [],
      error: err?.message ?? 'Unknown error',
    };
  });
}

/**
 * Close all cached MCP clients. Call on graceful server shutdown.
 */
export async function closeAllMCPClients(): Promise<void> {
  const entries = [...clientCache.entries()];
  clientCache.clear();
  await Promise.allSettled(entries.map(([id, entry]) => dropClient(id, entry)));
}

/**
 * Sanitize a server name for use as a tool namespace prefix.
 * Converts to lowercase, replaces non-alphanumeric chars with underscores.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
