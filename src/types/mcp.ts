/**
 * MCP Server Configuration Types
 *
 * Defines the data model for MCP (Model Context Protocol) server configurations.
 * Supports three transport types: stdio (local), sse, and http (remote).
 */

/** Transport type for MCP server connections */
export type MCPTransportType = 'stdio' | 'sse' | 'http';

/** Base configuration shared by all transport types */
interface MCPServerConfigBase {
  /** Unique identifier for the server */
  id: string;
  /** Display name for the server */
  name: string;
  /** Whether this server is enabled */
  enabled: boolean;
  /** Optional description */
  description?: string;
}

/** Configuration for stdio (local) MCP servers */
export interface MCPStdioConfig extends MCPServerConfigBase {
  transport: 'stdio';
  /** Command to run (e.g., "node", "python", "npx") */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Environment variables to set */
  env: Record<string, string>;
}

/** Configuration for SSE (Server-Sent Events) MCP servers */
export interface MCPSSEConfig extends MCPServerConfigBase {
  transport: 'sse';
  /** Server URL */
  url: string;
  /** Optional HTTP headers (e.g., Authorization) */
  headers?: Record<string, string>;
}

/** Configuration for HTTP (Streamable HTTP) MCP servers */
export interface MCPHTTPConfig extends MCPServerConfigBase {
  transport: 'http';
  /** Server URL */
  url: string;
  /** Optional HTTP headers (e.g., Authorization) */
  headers?: Record<string, string>;
}

/** Union type for all MCP server configurations */
export type MCPServerConfig = MCPStdioConfig | MCPSSEConfig | MCPHTTPConfig;

/** MCP servers stored as a record keyed by server ID */
export type MCPServersMap = Record<string, MCPServerConfig>;

/**
 * Generate a unique ID for a new MCP server config
 */
export function generateMCPServerId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a default stdio server config
 */
export function createDefaultStdioConfig(name?: string): MCPStdioConfig {
  return {
    id: generateMCPServerId(),
    name: name || 'New MCP Server',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
  };
}

/**
 * Create a default HTTP server config
 */
export function createDefaultHTTPConfig(name?: string): MCPHTTPConfig {
  return {
    id: generateMCPServerId(),
    name: name || 'New Remote Server',
    enabled: true,
    transport: 'http',
    url: '',
    headers: {},
  };
}

/**
 * Create a default SSE server config
 */
export function createDefaultSSEConfig(name?: string): MCPSSEConfig {
  return {
    id: generateMCPServerId(),
    name: name || 'New SSE Server',
    enabled: true,
    transport: 'sse',
    url: '',
    headers: {},
  };
}

/**
 * Validate an MCP server config
 * Returns null if valid, or an error message string
 */
export function validateMCPServerConfig(config: MCPServerConfig): string | null {
  if (!config.name.trim()) return 'Server name is required';

  switch (config.transport) {
    case 'stdio':
      if (!config.command.trim()) return 'Command is required';
      return null;
    case 'sse':
    case 'http':
      if (!config.url.trim()) return 'URL is required';
      try {
        new URL(config.url);
      } catch {
        return 'Invalid URL format';
      }
      return null;
    default:
      return 'Invalid transport type';
  }
}
