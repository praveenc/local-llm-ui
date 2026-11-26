/**
 * MCP Client Manager — creates, caches, and exposes MCP tools for streamText().
 *
 * Manages MCP client lifecycle with config-based caching. Clients are reused
 * when their config hasn't changed and recreated when it has.
 *
 * Security hardening (SEC-01 through SEC-11):
 * - Command allowlist for stdio transports (SEC-01)
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

import type {
  MCPHTTPConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPStdioConfig,
} from '../src/types/mcp.ts';

/** Separator used to namespace tool names: serverName__toolName */
const TOOL_NS_SEP = '__';

/** SEC-10: Connection timeout for MCP client creation and the tool listing (ms) */
const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 15_000;
let MCP_CONNECT_TIMEOUT_MS = DEFAULT_MCP_CONNECT_TIMEOUT_MS;

/** Test only: set a shorter connect timeout. No argument restores the default. */
export function setMCPConnectTimeoutForTests(ms: number = DEFAULT_MCP_CONNECT_TIMEOUT_MS): void {
  MCP_CONNECT_TIMEOUT_MS = ms;
}

// ─── Security: Command Allowlist (SEC-01) ────────────────────────────────────

/**
 * Allowlisted commands for stdio MCP servers.
 * Only these executables can be spawned as child processes.
 * Add to this list as needed — keep it minimal.
 */
const ALLOWED_STDIO_COMMANDS = new Set([
  'node',
  'npx',
  'python',
  'python3',
  'uvx',
  'uv',
  'docker',
  'deno',
  'bun',
  'bunx',
]);

/** Shell metacharacters that could enable command injection in args */
const SHELL_METACHAR_PATTERN = /[;&|`$(){}!<>]/;

/**
 * SEC-01: Validate stdio MCP config — command allowlist + arg sanitization.
 * Throws if the command is not allowed or args contain shell metacharacters.
 */
function validateStdioSecurity(config: MCPStdioConfig): void {
  const cmd = config.command.trim().toLowerCase();

  // Block absolute/relative paths — only bare command names allowed
  if (cmd.includes('/') || cmd.includes('\\')) {
    throw new Error(
      `[MCP Security] Command paths are not allowed: '${config.command}'. Use a bare command name (e.g., 'node', 'uvx').`
    );
  }

  if (!ALLOWED_STDIO_COMMANDS.has(cmd)) {
    throw new Error(
      `[MCP Security] Command '${config.command}' is not in the allowlist. ` +
        `Allowed: ${[...ALLOWED_STDIO_COMMANDS].join(', ')}`
    );
  }

  for (const arg of config.args) {
    if (SHELL_METACHAR_PATTERN.test(arg)) {
      throw new Error(`[MCP Security] Argument contains shell metacharacters: '${arg}'`);
    }
  }
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
    throw new Error(`[MCP Security] Invalid URL: '${urlString}'`);
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
/** A child that ignores SIGTERM after a close gets SIGKILL after this time (ms) */
const KILL_GRACE_MS = 2000;

// ANSI escape sequences: CSI, OSC, and the short two-character forms
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

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
 */
class DiscoveryWaitingStdioTransport extends Experimental_StdioMCPTransport {
  readonly waitsForProtocolVersionDiscovery = true;

  /** Set when the child stops; undefined while it runs or before it starts */
  exit: ChildExit | undefined;
  /** Called once when the child stops on its own after the client connected */
  onProcessExit: (() => void) | undefined;

  private readonly serverName: string;
  private stderrTail = Buffer.alloc(0);
  private partialLine = '';
  private child: ChildProcess | undefined;
  private closing = false;

  constructor(
    params: ConstructorParameters<typeof Experimental_StdioMCPTransport>[0],
    serverName: string
  ) {
    super({ ...params, stderr: 'pipe' });
    this.serverName = serverName;
  }

  override async start(): Promise<void> {
    await super.start();
    // The SDK keeps the child in a `private process` field (no getter), and clears it
    // on close. This is the only read of it: once, right after the spawn.
    const child = (this as unknown as { process?: ChildProcess }).process;
    if (!child) return;
    this.child = child;
    // Read the pipe always, so a server that writes a lot cannot block on it
    child.stderr?.on('data', (chunk: Buffer) => this.onStderr(chunk));
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
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

    const lines = (this.partialLine + chunk.toString('utf8')).split('\n');
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
function errorField(error: unknown, field: 'message' | 'code'): string | undefined {
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

/**
 * Turn a failed start or tool listing into text that says what happened, with the
 * end of the child's error output when there is some.
 */
function describeFailure(
  error: unknown,
  config: MCPServerConfig,
  transport: DiscoveryWaitingStdioTransport | undefined
): Error {
  const output = transport?.outputSummary() ?? '';
  const lastOutput = output ? ` Last output: ${output}` : '';

  if (isTimeoutError(error)) {
    return new Error(
      `The server did not answer in ${formatSeconds(MCP_CONNECT_TIMEOUT_MS)}.${lastOutput}`,
      { cause: error }
    );
  }
  if (config.transport === 'stdio' && hasErrorCode(error, 'ENOENT')) {
    return new Error(`Command not found: ${config.command}`, { cause: error });
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
}

/** Global client cache keyed by server ID */
const clientCache = new Map<string, CachedClient>();

/** Starts in progress, keyed by server ID. A second call with the same hash waits for it. */
const startsInProgress = new Map<string, { configHash: string; promise: Promise<CachedClient> }>();

let startSeq = 0;

/**
 * Compute a simple hash string from the transport-relevant parts of a config.
 * Used to detect config changes and invalidate cached clients.
 */
function computeConfigHash(config: MCPServerConfig): string {
  const parts: string[] = [config.id, config.transport];
  switch (config.transport) {
    case 'stdio':
      parts.push(config.command, ...config.args, JSON.stringify(config.env));
      break;
    case 'sse':
    case 'http':
      parts.push(config.url, JSON.stringify(config.headers ?? {}));
      break;
  }
  return parts.join('|');
}

/** Remove a client from the cache (only if it is still the cached one) and close it */
async function dropClient(id: string, entry: CachedClient): Promise<void> {
  if (clientCache.get(id) === entry) clientCache.delete(id);
  try {
    await entry.client.close();
  } catch {
    // Ignore close errors
  }
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
      const transport = new DiscoveryWaitingStdioTransport(
        {
          command: stdioConfig.command,
          args: stdioConfig.args,
          env: { ...getSafeEnv(), ...stdioConfig.env },
        },
        config.name
      );
      let client: MCPClient;
      try {
        client = await createMCPClient({ transport, initializationOptions });
      } catch (error) {
        throw describeFailure(error, config, transport);
      }
      const entry: CachedClient = { client, configHash, transport, seq };
      transport.onProcessExit = () => {
        void dropClient(config.id, entry);
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
        return { client, configHash, transport: undefined, seq };
      } catch (error) {
        throw describeFailure(error, config, undefined);
      }
    }
  }
}

/** Start a client, and put it in the cache unless a newer start already did */
async function startClient(config: MCPServerConfig, configHash: string): Promise<CachedClient> {
  const entry = await createClient(config, configHash);

  // A stdio child that stopped between the connect and now
  if (entry.transport?.exit) {
    await dropClient(config.id, entry);
    throw describeFailure(new Error('Connection closed'), config, entry.transport);
  }

  const current = clientCache.get(config.id);
  if (current && current.seq > entry.seq) {
    // A start with newer settings won the race: this client is stale
    await dropClient(config.id, entry);
    throw new Error('The server settings changed while it started.');
  }
  clientCache.set(config.id, entry);
  // Config changed — close the old client now that the new one runs
  if (current) await dropClient(config.id, current);
  return entry;
}

/**
 * Get or create a cached MCP client for the given config.
 * Closes and replaces the client if the config has changed.
 * One start runs for each server and config at a time.
 */
async function getOrCreateClient(config: MCPServerConfig): Promise<CachedClient> {
  // SEC-01/02/03/11: Validate before the hash and before any start
  validateMCPConfig(config);
  const hash = computeConfigHash(config);
  const cached = clientCache.get(config.id);

  if (cached && cached.configHash === hash && !cached.transport?.exit) {
    return cached;
  }

  const pending = startsInProgress.get(config.id);
  if (pending && pending.configHash === hash) {
    return pending.promise;
  }

  const promise = startClient(config, hash);
  const start = { configHash: hash, promise };
  startsInProgress.set(config.id, start);
  try {
    return await promise;
  } finally {
    if (startsInProgress.get(config.id) === start) startsInProgress.delete(config.id);
  }
}

type MCPToolSet = ReturnType<MCPClient['toolsFromDefinitions']>;

/**
 * Connect to a server and list its tools. The listing has the same timeout as
 * the start. A timeout in the listing closes the client and removes it from the
 * cache, so no process stays.
 */
async function listServerTools(config: MCPServerConfig): Promise<MCPToolSet> {
  const entry = await getOrCreateClient(config);
  const deadline = Date.now() + MCP_CONNECT_TIMEOUT_MS;
  const timeout = () => Math.max(1, deadline - Date.now());
  try {
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
  } catch (error) {
    if (isTimeoutError(error)) await dropClient(config.id, entry);
    throw describeFailure(error, config, entry.transport);
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

  // Connect to each server and gather tools in parallel
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const serverTools = await listServerTools(config);
      return { config, serverTools };
    })
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const { config, serverTools } = result.value;
      activeIds.add(config.id);

      // Namespace each tool with the server name
      const prefix = sanitizeName(config.name);
      for (const [toolName, tool] of Object.entries(serverTools)) {
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
   * Cleanup function: close clients that are no longer in the active config set.
   * Cached clients that are still active are kept for reuse.
   */
  const cleanup = async () => {
    const stale = [...clientCache.entries()].filter(([id]) => !activeIds.has(id));
    await Promise.allSettled(stale.map(([id, entry]) => dropClient(id, entry)));
  };

  return { tools, cleanup };
}

/**
 * Check connectivity and list tools for each MCP server config.
 * Returns per-server status (connected/error) and tool names.
 */
export async function getMCPServerStatus(configs: MCPServerConfig[]): Promise<
  Array<{
    name: string;
    id: string;
    status: 'connected' | 'error';
    tools: string[];
    error?: string;
  }>
> {
  if (!configs || configs.length === 0) return [];

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const serverTools = await listServerTools(config);
      return {
        name: config.name,
        id: config.id,
        status: 'connected' as const,
        tools: Object.keys(serverTools),
      };
    })
  );

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
