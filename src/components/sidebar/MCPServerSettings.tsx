/**
 * MCPServerSettings
 *
 * UI for managing MCP (Model Context Protocol) server configurations.
 * Inspired by Zed editor's clean MCP server configuration UX.
 *
 * Supports three transport types:
 * - stdio: Local servers (command + args + env)
 * - http: Remote servers via Streamable HTTP
 * - sse: Remote servers via Server-Sent Events
 */
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Globe,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

import type {
  MCPHTTPConfig,
  MCPSSEConfig,
  MCPServerConfig,
  MCPServersMap,
  MCPStdioConfig,
  MCPTransportType,
} from '../../types/mcp';
import {
  createDefaultHTTPConfig,
  createDefaultSSEConfig,
  createDefaultStdioConfig,
  validateMCPServerConfig,
} from '../../types/mcp';

// ─── Key-Value Editor (for env vars and headers) ──────────────────────────────

interface KeyValueEditorProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  valueType?: 'text' | 'password';
}

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  valueType = 'text',
}: KeyValueEditorProps) {
  const pairs = Object.entries(entries);

  const updateKey = (oldKey: string, newKey: string) => {
    const updated = { ...entries };
    const value = updated[oldKey];
    delete updated[oldKey];
    if (newKey) updated[newKey] = value;
    onChange(updated);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...entries, [key]: value });
  };

  const addEntry = () => {
    const key = `KEY_${pairs.length + 1}`;
    onChange({ ...entries, [key]: '' });
  };

  const removeEntry = (key: string) => {
    const updated = { ...entries };
    delete updated[key];
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {pairs.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <Input
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            placeholder={keyPlaceholder}
            className="h-8 text-xs font-mono flex-1"
          />
          <Input
            type={valueType}
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder={valuePlaceholder}
            className="h-8 text-xs font-mono flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeEntry(key)}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addEntry} className="h-7 text-xs gap-1">
        <Plus className="h-3 w-3" />
        Add
      </Button>
    </div>
  );
}

// ─── Args Editor (for command arguments) ──────────────────────────────────────

interface ArgsEditorProps {
  args: string[];
  onChange: (args: string[]) => void;
}

function ArgsEditor({ args, onChange }: ArgsEditorProps) {
  const updateArg = (index: number, value: string) => {
    const updated = [...args];
    updated[index] = value;
    onChange(updated);
  };

  const addArg = () => onChange([...args, '']);

  const removeArg = (index: number) => {
    onChange(args.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {args.map((arg, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={arg}
            onChange={(e) => updateArg(index, e.target.value)}
            placeholder={`Argument ${index + 1}`}
            className="h-8 text-xs font-mono"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeArg(index)}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addArg} className="h-7 text-xs gap-1">
        <Plus className="h-3 w-3" />
        Add argument
      </Button>
    </div>
  );
}

// ─── Server Config Form ───────────────────────────────────────────────────────

interface ServerConfigFormProps {
  config: MCPServerConfig;
  onChange: (config: MCPServerConfig) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}

function ServerConfigForm({ config, onChange, onDelete, onToggleEnabled }: ServerConfigFormProps) {
  const [expanded, setExpanded] = useState(true);
  const validationError = validateMCPServerConfig(config);

  const updateField = <K extends keyof MCPServerConfig>(key: K, value: MCPServerConfig[K]) => {
    onChange({ ...config, [key]: value } as MCPServerConfig);
  };

  const handleTransportChange = (transport: MCPTransportType) => {
    // Create a new config with the correct transport type, preserving name/id/enabled
    let newConfig: MCPServerConfig;
    switch (transport) {
      case 'stdio':
        newConfig = {
          ...createDefaultStdioConfig(),
          id: config.id,
          name: config.name,
          enabled: config.enabled,
          description: config.description,
        };
        break;
      case 'http':
        newConfig = {
          ...createDefaultHTTPConfig(),
          id: config.id,
          name: config.name,
          enabled: config.enabled,
          description: config.description,
        };
        break;
      case 'sse':
        newConfig = {
          ...createDefaultSSEConfig(),
          id: config.id,
          name: config.name,
          enabled: config.enabled,
          description: config.description,
        };
        break;
    }
    onChange(newConfig);
  };

  const transportIcon =
    config.transport === 'stdio' ? (
      <Terminal className="h-3.5 w-3.5" />
    ) : (
      <Globe className="h-3.5 w-3.5" />
    );

  return (
    <div
      className={`border rounded-lg ${config.enabled ? 'border-border' : 'border-border/50 opacity-60'}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 rounded-t-lg"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        {transportIcon}
        <span className="text-sm font-medium flex-1 truncate">{config.name || 'Untitled'}</span>
        {validationError && (
          <span title={validationError}>
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          </span>
        )}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {config.transport}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggleEnabled();
          }}
          className="h-7 w-7 p-0"
          title={config.enabled ? 'Disable server' : 'Enable server'}
        >
          {config.enabled ? (
            <Power className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          title="Remove server"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50">
          <div className="pt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={config.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="My MCP Server"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Transport</Label>
              <Select value={config.transport} onValueChange={handleTransportChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">
                    <span className="flex items-center gap-1.5">
                      <Terminal className="h-3 w-3" />
                      stdio (local)
                    </span>
                  </SelectItem>
                  <SelectItem value="http">
                    <span className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      HTTP (remote)
                    </span>
                  </SelectItem>
                  <SelectItem value="sse">
                    <span className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      SSE (remote)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={config.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="What does this server provide?"
              className="h-8 text-xs"
            />
          </div>

          <Separator />

          {/* Transport-specific fields */}
          {config.transport === 'stdio' ? (
            <StdioFields config={config as MCPStdioConfig} onChange={onChange} />
          ) : (
            <RemoteFields config={config as MCPHTTPConfig | MCPSSEConfig} onChange={onChange} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stdio-specific fields ────────────────────────────────────────────────────

function StdioFields({
  config,
  onChange,
}: {
  config: MCPStdioConfig;
  onChange: (config: MCPServerConfig) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Command</Label>
        <Input
          value={config.command}
          onChange={(e) => onChange({ ...config, command: e.target.value })}
          placeholder="node, python, npx, etc."
          className="h-8 text-xs font-mono"
        />
        <p className="text-[10px] text-muted-foreground">
          The command to run the MCP server process
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Arguments</Label>
        <ArgsEditor args={config.args} onChange={(args) => onChange({ ...config, args })} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Environment Variables</Label>
        <KeyValueEditor
          entries={config.env}
          onChange={(env) => onChange({ ...config, env })}
          keyPlaceholder="VARIABLE_NAME"
          valuePlaceholder="value"
        />
      </div>
    </>
  );
}

// ─── Remote (HTTP/SSE) specific fields ────────────────────────────────────────

function RemoteFields({
  config,
  onChange,
}: {
  config: MCPHTTPConfig | MCPSSEConfig;
  onChange: (config: MCPServerConfig) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">URL</Label>
        <Input
          value={config.url}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
          placeholder={
            config.transport === 'sse'
              ? 'https://your-server.com/sse'
              : 'https://your-server.com/mcp'
          }
          className="h-8 text-xs font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Headers (optional)</Label>
        <KeyValueEditor
          entries={config.headers || {}}
          onChange={(headers) => onChange({ ...config, headers })}
          keyPlaceholder="Header-Name"
          valuePlaceholder="header-value"
          valueType="password"
        />
        <p className="text-[10px] text-muted-foreground">
          e.g., Authorization: Bearer your-api-key
        </p>
      </div>
    </>
  );
}

// ─── Main Settings Component ──────────────────────────────────────────────────

interface MCPServerSettingsProps {
  servers: MCPServersMap;
  onChange: (servers: MCPServersMap) => void;
}

export function MCPServerSettings({ servers, onChange }: MCPServerSettingsProps) {
  const serverList = Object.values(servers);
  const enabledCount = serverList.filter((s) => s.enabled).length;

  const addServer = (transport: MCPTransportType) => {
    let config: MCPServerConfig;
    switch (transport) {
      case 'stdio':
        config = createDefaultStdioConfig();
        break;
      case 'http':
        config = createDefaultHTTPConfig();
        break;
      case 'sse':
        config = createDefaultSSEConfig();
        break;
    }
    onChange({ ...servers, [config.id]: config });
  };

  const updateServer = (id: string, config: MCPServerConfig) => {
    onChange({ ...servers, [id]: config });
  };

  const deleteServer = (id: string) => {
    const updated = { ...servers };
    delete updated[id];
    onChange(updated);
  };

  const toggleServer = (id: string) => {
    const server = servers[id];
    if (server) {
      onChange({ ...servers, [id]: { ...server, enabled: !server.enabled } });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">MCP Servers</h4>
          <p className="text-xs text-muted-foreground">
            {serverList.length === 0
              ? 'No servers configured'
              : `${enabledCount} of ${serverList.length} enabled`}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => addServer('stdio')}
            className="h-7 text-xs gap-1"
          >
            <Terminal className="h-3 w-3" />
            Local
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addServer('http')}
            className="h-7 text-xs gap-1"
          >
            <Globe className="h-3 w-3" />
            Remote
          </Button>
        </div>
      </div>

      {serverList.length === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center">
          <Pencil className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No MCP servers configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add a local (stdio) or remote (HTTP/SSE) MCP server to extend your AI with custom tools.
          </p>
          <div className="flex gap-2 justify-center mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => addServer('stdio')}
              className="text-xs gap-1"
            >
              <Terminal className="h-3 w-3" />
              Add Local Server
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addServer('http')}
              className="text-xs gap-1"
            >
              <Globe className="h-3 w-3" />
              Add Remote Server
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {serverList.map((server) => (
            <ServerConfigForm
              key={server.id}
              config={server}
              onChange={(updated) => updateServer(server.id, updated)}
              onDelete={() => deleteServer(server.id)}
              onToggleEnabled={() => toggleServer(server.id)}
            />
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Visit the{' '}
        <a
          href="https://modelcontextprotocol.io/docs/tools/inspector"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          MCP documentation
        </a>{' '}
        to find server configuration details. Stdio servers run locally; HTTP/SSE servers connect to
        remote endpoints.
      </p>
    </div>
  );
}
