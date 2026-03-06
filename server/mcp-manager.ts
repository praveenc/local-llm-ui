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
 */
import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';

import type {
  MCPHTTPConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPStdioConfig,
} from '../src/types/mcp';

/** Separator used to namespace tool names: serverName__toolName */
const TOOL_NS_SEP = '__';

/** SEC-10: Connection timeout for MCP client creation (ms) */
const MCP_CONNECT_TIMEOUT_MS = 15_000;

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
    throw new Error(
      `[MCP Security] Invalid MCP config structure: ${JSON.stringify(config)?.slice(0, 200)}`
    );
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

// ─── Client Caching ──────────────────────────────────────────────────────────

/** Cached client entry */
interface CachedClient {
  client: MCPClient;
  configHash: string;
}

/** Global client cache keyed by server ID */
const clientCache = new Map<string, CachedClient>();

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

/**
 * SEC-10: Create an MCP client with a connection timeout.
 */
async function createClientWithTimeout(config: MCPServerConfig): Promise<MCPClient> {
  return Promise.race([
    createClient(config),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`[MCP] Connection timeout after ${MCP_CONNECT_TIMEOUT_MS}ms: ${config.name}`)
          ),
        MCP_CONNECT_TIMEOUT_MS
      )
    ),
  ]);
}

/**
 * Create an MCP client for the given server config.
 * Security validations run before client creation.
 */
async function createClient(config: MCPServerConfig): Promise<MCPClient> {
  // SEC-01/02/03/11: Validate before creating
  validateMCPConfig(config);

  switch (config.transport) {
    case 'stdio': {
      const stdioConfig = config as MCPStdioConfig;
      const transport = new Experimental_StdioMCPTransport({
        command: stdioConfig.command,
        args: stdioConfig.args,
        env: { ...getSafeEnv(), ...stdioConfig.env },
      });
      return createMCPClient({ transport });
    }
    case 'sse': {
      const sseConfig = config as MCPSSEConfig;
      return createMCPClient({
        transport: {
          type: 'sse',
          url: sseConfig.url,
          headers: sseConfig.headers,
        },
      });
    }
    case 'http': {
      const httpConfig = config as MCPHTTPConfig;
      return createMCPClient({
        transport: {
          type: 'http',
          url: httpConfig.url,
          headers: httpConfig.headers,
        },
      });
    }
  }
}

/**
 * Get or create a cached MCP client for the given config.
 * Closes and replaces the client if the config has changed.
 */
async function getOrCreateClient(config: MCPServerConfig): Promise<MCPClient> {
  const hash = computeConfigHash(config);
  const cached = clientCache.get(config.id);

  if (cached && cached.configHash === hash) {
    return cached.client;
  }

  // Config changed — close old client if it exists
  if (cached) {
    try {
      await cached.client.close();
    } catch {
      // Ignore close errors
    }
  }

  const client = await createClientWithTimeout(config);
  clientCache.set(config.id, { client, configHash: hash });
  return client;
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
      const client = await getOrCreateClient(config);
      const serverTools = await client.tools();
      return { config, serverTools };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { config, serverTools } = result.value;
      activeIds.add(config.id);

      // Namespace each tool with the server name
      const prefix = sanitizeName(config.name);
      for (const [toolName, tool] of Object.entries(serverTools)) {
        tools[`${prefix}${TOOL_NS_SEP}${toolName}`] = tool;
      }
    } else {
      console.warn('[MCP Manager] Failed to connect to MCP server:', result.reason);
    }
  }

  /**
   * Cleanup function: close clients that are no longer in the active config set.
   * Cached clients that are still active are kept for reuse.
   */
  const cleanup = async () => {
    const staleIds: string[] = [];
    for (const id of clientCache.keys()) {
      if (!activeIds.has(id)) {
        staleIds.push(id);
      }
    }
    await Promise.allSettled(
      staleIds.map(async (id) => {
        const cached = clientCache.get(id);
        if (cached) {
          clientCache.delete(id);
          await cached.client.close();
        }
      })
    );
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
      const client = await getOrCreateClient(config);
      const serverTools = await client.tools();
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
  await Promise.allSettled(
    entries.map(async ([, { client }]) => {
      await client.close();
    })
  );
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
