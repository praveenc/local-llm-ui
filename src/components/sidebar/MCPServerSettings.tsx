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
  TriangleAlert,
  X,
} from 'lucide-react';

import { useEffect, useId, useRef, useState } from 'react';

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
import { hasOuterQuotes } from '../../utils/mcpFieldHints';

// ─── Quote warning ────────────────────────────────────────────────────────────

const QUOTE_WARNING =
  'The quotes are part of this value. Remove them unless the server needs them.';

function QuoteWarning({ id }: { id: string }) {
  return (
    <p id={id} className="flex items-start gap-1 text-xs text-status-warn">
      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      {QUOTE_WARNING}
    </p>
  );
}

// ─── Key-Value Editor (for env vars and headers) ──────────────────────────────

interface KeyValueEditorProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  valueType?: 'text' | 'password';
  /** Singular noun used in accessible names, e.g. "Header" */
  label: string;
  /** Id of a help text that describes every name and value input */
  helpId?: string;
  /** Warn under a value that starts and ends with the same quote */
  warnQuotes?: boolean;
}

interface KeyValueRow {
  id: number;
  key: string;
  value: string;
}

/** Join the ids that exist into one aria-describedby value */
const describedBy = (...ids: Array<string | undefined>): string | undefined =>
  ids.filter(Boolean).join(' ') || undefined;

let nextRowId = 0;
const toRows = (entries: Record<string, string>): KeyValueRow[] =>
  Object.entries(entries).map(([key, value]) => ({ id: nextRowId++, key, value }));

// Rows with an empty or repeated name are kept on screen but not saved
const toEntries = (rows: KeyValueRow[]): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const { key, value } of rows) {
    const name = key.trim();
    if (name && !(name in entries)) entries[name] = value;
  }
  return entries;
};

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  valueType = 'text',
  label,
  helpId,
  warnQuotes = false,
}: KeyValueEditorProps) {
  // Local rows with stable ids, so a row keeps its place and its focus while its name is
  // typed. Keying rows by the name re-created the row on every keystroke.
  const [rows, setRows] = useState<KeyValueRow[]>(() => toRows(entries));
  // The label can contain spaces, which an id used in aria-describedby must not
  const baseId = useId();
  const [prevEntries, setPrevEntries] = useState(entries);
  // New entries that the rows do not already hold came from outside (a reload, a reset):
  // show those instead (adjusting state during render)
  if (entries !== prevEntries) {
    setPrevEntries(entries);
    if (JSON.stringify(entries) !== JSON.stringify(toEntries(rows))) setRows(toRows(entries));
  }

  const lastKeyRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    lastKeyRef.current?.focus();
  });

  const commit = (next: KeyValueRow[]) => {
    setRows(next);
    onChange(toEntries(next));
  };

  const updateRow = (id: number, change: Partial<KeyValueRow>) =>
    commit(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));

  const addRow = () => {
    focusNewRow.current = true;
    commit([...rows, { id: nextRowId++, key: '', value: '' }]);
  };

  const removeRow = (id: number) => commit(rows.filter((row) => row.id !== id));

  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.key.trim();
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const name = row.key.trim();
        const rowError =
          name && (nameCounts.get(name) ?? 0) > 1
            ? 'This name is used twice; only the first one is saved.'
            : !name && row.value
              ? 'Add a name, or this row is not saved.'
              : null;
        const errorId = `${baseId}-${row.id}-error`;
        const quoteId = `${baseId}-${row.id}-quotes`;
        const showQuoteWarning = warnQuotes && hasOuterQuotes(row.value);
        const nameDescribedBy = describedBy(rowError ? errorId : undefined, helpId);
        const valueDescribedBy = describedBy(showQuoteWarning ? quoteId : undefined, helpId);
        return (
          <div key={row.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                ref={index === rows.length - 1 ? lastKeyRef : undefined}
                aria-label={`${label} name ${index + 1}`}
                aria-invalid={rowError ? true : undefined}
                aria-describedby={nameDescribedBy}
                value={row.key}
                onChange={(e) => updateRow(row.id, { key: e.target.value })}
                placeholder={keyPlaceholder}
                className="h-8 text-xs font-mono flex-1"
              />
              <Input
                aria-label={`${label} value ${index + 1}`}
                type={valueType}
                aria-describedby={valueDescribedBy}
                value={row.value}
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
                placeholder={valuePlaceholder}
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove ${label.toLowerCase()} ${row.key.trim() || index + 1}`}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
            {rowError && (
              <p id={errorId} className="text-xs text-destructive">
                {rowError}
              </p>
            )}
            {showQuoteWarning && <QuoteWarning id={quoteId} />}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={addRow}
        aria-label={`Add ${label.toLowerCase()}`}
        className="h-7 text-xs gap-1"
      >
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
  /** Id of the help text that describes every argument field */
  helpId: string;
}

// The first two fields show a real example; the others say which argument they are
const argPlaceholder = (index: number): string =>
  index === 0 ? '-y' : index === 1 ? 'package-name' : `Argument ${index + 1}`;

function ArgsEditor({ args, onChange, helpId }: ArgsEditorProps) {
  const baseId = useId();
  const updateArg = (index: number, value: string) => {
    const updated = [...args];
    updated[index] = value;
    onChange(updated);
  };

  const lastArgRef = useRef<HTMLInputElement>(null);
  const focusNewArg = useRef(false);
  useEffect(() => {
    if (!focusNewArg.current) return;
    focusNewArg.current = false;
    lastArgRef.current?.focus();
  });
  const addArg = () => {
    focusNewArg.current = true;
    onChange([...args, '']);
  };

  const removeArg = (index: number) => {
    onChange(args.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {args.map((arg, index) => {
        const quoteId = `${baseId}-${index}-quotes`;
        const showQuoteWarning = hasOuterQuotes(arg);
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                ref={index === args.length - 1 ? lastArgRef : undefined}
                aria-label={`Argument ${index + 1}`}
                aria-describedby={describedBy(showQuoteWarning ? quoteId : undefined, helpId)}
                value={arg}
                onChange={(e) => updateArg(index, e.target.value)}
                placeholder={argPlaceholder(index)}
                className="h-8 text-xs font-mono"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeArg(index)}
                aria-label={`Remove argument ${index + 1}`}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
            {showQuoteWarning && <QuoteWarning id={quoteId} />}
          </div>
        );
      })}
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
  /** Added in this session: its field errors wait until the user leaves the field */
  isNew: boolean;
}

function ServerConfigForm({
  config,
  onChange,
  onDelete,
  onToggleEnabled,
  isNew,
}: ServerConfigFormProps) {
  // A new server opens with the cursor in Name; saved servers start closed
  const [expanded, setExpanded] = useState(isNew);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusNameOnMount = useRef(isNew);
  useEffect(() => {
    if (focusNameOnMount.current) nameInputRef.current?.focus();
  }, []);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const validationError = validateMCPServerConfig(config);
  const id = config.id;
  const panelId = `${id}-panel`;
  // Work out which field the message is about so it can be flagged
  const errorField = !validationError
    ? null
    : validationError.startsWith('Server name')
      ? 'name'
      : validationError.startsWith('Command')
        ? 'command'
        : validationError.includes('URL')
          ? 'url'
          : null;
  // The error shows under its field; on a new server only after the user has left that field
  const fieldError: FieldErrorFor = (field) => {
    const message = errorField === field && (!isNew || touched[field]) ? validationError : null;
    return {
      message,
      id: `${id}-${field}-error`,
      onBlur: () => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
    };
  };
  const nameError = fieldError('name');

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

  const trimmedName = config.name.trim();
  const displayName =
    trimmedName || (config.transport === 'stdio' ? 'New local server' : 'New remote server');

  const transportIcon =
    config.transport === 'stdio' ? (
      <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
    );

  return (
    <div
      className={`border rounded-lg ${config.enabled ? 'border-border' : 'border-border/50 opacity-60'}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 rounded-t-lg">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 min-w-0 items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <ChevronDown
              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
          )}
          {transportIcon}
          <span
            className={`text-sm font-medium flex-1 truncate ${trimmedName ? '' : 'text-muted-foreground'}`}
          >
            {displayName}
          </span>
        </button>
        {validationError && (
          <AlertCircle
            role="img"
            aria-label={validationError}
            className="h-3.5 w-3.5 text-status-warn shrink-0"
          />
        )}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {config.transport}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleEnabled}
          className="h-7 w-7 p-0"
          aria-label={`${config.enabled ? 'Disable' : 'Enable'} server ${displayName}`}
          title={config.enabled ? 'Disable server' : 'Enable server'}
        >
          {config.enabled ? (
            <Power className="h-3.5 w-3.5 text-status-ok" />
          ) : (
            <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove server ${displayName}`}
          title="Remove server"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div id={panelId} className="px-3 pb-3 space-y-3 border-t border-border/50">
          {validationError && !errorField && (
            <p className="pt-3 text-xs text-destructive">{validationError}</p>
          )}
          <div className="pt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-name`} className="text-xs">
                Name
              </Label>
              <Input
                id={`${id}-name`}
                ref={nameInputRef}
                onBlur={nameError.onBlur}
                aria-invalid={nameError.message ? true : undefined}
                aria-describedby={nameError.message ? nameError.id : undefined}
                value={config.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="my-server"
                className="h-8 text-xs"
              />
              <FieldErrorText error={nameError} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-transport`} className="text-xs">
                Transport
              </Label>
              <Select value={config.transport} onValueChange={handleTransportChange}>
                <SelectTrigger id={`${id}-transport`} size="sm" className="w-full text-xs">
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
            <Label htmlFor={`${id}-description`} className="text-xs">
              Description (optional)
            </Label>
            <Input
              id={`${id}-description`}
              value={config.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="What does this server provide?"
              className="h-8 text-xs"
            />
          </div>

          <Separator />

          {/* Transport-specific fields */}
          {config.transport === 'stdio' ? (
            <StdioFields
              config={config as MCPStdioConfig}
              onChange={onChange}
              fieldError={fieldError}
            />
          ) : (
            <RemoteFields
              config={config as MCPHTTPConfig | MCPSSEConfig}
              onChange={onChange}
              fieldError={fieldError}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stdio-specific fields ────────────────────────────────────────────────────

interface FieldError {
  message: string | null;
  id: string;
  onBlur: () => void;
}
type FieldErrorFor = (field: string) => FieldError;

function FieldErrorText({ error }: { error: FieldError }) {
  if (!error.message) return null;
  return (
    <p id={error.id} className="text-xs text-destructive">
      {error.message}
    </p>
  );
}

function StdioFields({
  config,
  onChange,
  fieldError,
}: {
  config: MCPStdioConfig;
  onChange: (config: MCPServerConfig) => void;
  fieldError: FieldErrorFor;
}) {
  const id = config.id;
  const commandHelpId = `${id}-command-help`;
  const argsHelpId = `${id}-args-help`;
  const envHelpId = `${id}-env-help`;
  const commandError = fieldError('command');
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-command`} className="text-xs">
          Command
        </Label>
        <Input
          id={`${id}-command`}
          onBlur={commandError.onBlur}
          aria-invalid={commandError.message ? true : undefined}
          aria-describedby={
            commandError.message ? `${commandError.id} ${commandHelpId}` : commandHelpId
          }
          value={config.command}
          onChange={(e) => onChange({ ...config, command: e.target.value })}
          placeholder="npx, uvx, node, python, etc."
          className="h-8 text-xs font-mono"
        />
        <FieldErrorText error={commandError} />
        <p id={commandHelpId} className="text-[10px] text-muted-foreground">
          The program that starts the server. Put its arguments in the fields below.
        </p>
      </div>

      <div role="group" aria-labelledby={`${id}-args-label`} className="space-y-1.5">
        <Label id={`${id}-args-label`} className="text-xs">
          Arguments
        </Label>
        <p id={argsHelpId} className="text-[10px] text-muted-foreground">
          One argument in each field, with no quotes. The app does not use a shell, so it passes
          each field as you type it.
        </p>
        <ArgsEditor
          args={config.args}
          onChange={(args) => onChange({ ...config, args })}
          helpId={argsHelpId}
        />
      </div>

      <div role="group" aria-labelledby={`${id}-env-label`} className="space-y-1.5">
        <Label id={`${id}-env-label`} className="text-xs">
          Environment Variables
        </Label>
        <p id={envHelpId} className="text-[10px] text-muted-foreground">
          One variable in each row, with no quotes. The app does not expand <code>$VAR</code> or{' '}
          <code>~</code>: type the full value.
        </p>
        <KeyValueEditor
          label="Environment variable"
          entries={config.env}
          onChange={(env) => onChange({ ...config, env })}
          keyPlaceholder="NAME"
          valuePlaceholder="value"
          helpId={envHelpId}
          warnQuotes
        />
      </div>
    </>
  );
}

// ─── Remote (HTTP/SSE) specific fields ────────────────────────────────────────

function RemoteFields({
  config,
  onChange,
  fieldError,
}: {
  config: MCPHTTPConfig | MCPSSEConfig;
  onChange: (config: MCPServerConfig) => void;
  fieldError: FieldErrorFor;
}) {
  const id = config.id;
  const urlError = fieldError('url');
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-url`} className="text-xs">
          URL
        </Label>
        <Input
          id={`${id}-url`}
          onBlur={urlError.onBlur}
          aria-invalid={urlError.message ? true : undefined}
          aria-describedby={urlError.message ? urlError.id : undefined}
          value={config.url}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
          placeholder={
            config.transport === 'sse'
              ? 'https://your-server.com/sse'
              : 'https://your-server.com/mcp'
          }
          className="h-8 text-xs font-mono"
        />
        <FieldErrorText error={urlError} />
      </div>

      <div role="group" aria-labelledby={`${id}-headers-label`} className="space-y-1.5">
        <Label id={`${id}-headers-label`} className="text-xs">
          Headers (optional)
        </Label>
        <KeyValueEditor
          label="Header"
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
  // Servers added while this tab is open have not been filled in yet
  const [addedIds, setAddedIds] = useState<string[]>([]);
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
    setAddedIds((prev) => [...prev, config.id]);
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
        {/* With no servers, the empty box below holds the add buttons */}
        {serverList.length > 0 && (
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
        )}
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
              isNew={addedIds.includes(server.id)}
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
