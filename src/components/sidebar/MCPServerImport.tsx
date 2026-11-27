/**
 * MCPServerImport
 *
 * The import of MCP servers from other tools in the MCP Servers tab (item 25, D19): a line
 * "N servers in Kiro and Pi are not in this app" with **Import** and **Not now**, and the list
 * in the tab. Imported servers are off (D18). No dialog over Preferences.
 */
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { readMCPImport } from '../../services/mcpImport';
import type { MCPServerConfig, MCPServersMap } from '../../types/mcp';
import { generateMCPServerId } from '../../types/mcp';
import {
  FILE_STATUS_TEXT,
  MCP_IMPORT_TOOLS,
  buildImportRows,
  foundInText,
  hasNewImports,
  importLineText,
  importableRows,
} from '../../utils/mcpImport';
import type { ImportRow, MCPImportScan, ScannedServer } from '../../utils/mcpImport';

interface MCPServerImportProps {
  scan: MCPImportScan;
  servers: MCPServersMap;
  /** The short hashes of the "same server" keys that **Not now** stored (`dismissKey`) */
  dismissed: readonly string[];
  onDismiss: (keys: string[]) => void;
  /** Add these servers (all off) through the preferences save */
  onImport: (configs: MCPServerConfig[]) => void;
}

// 44 px on a touch screen of any width, as the other touch targets of the app
const BUTTON = 'h-8 text-xs pointer-coarse:h-11';

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** One line that says what the server runs or reaches. It has no secret value. */
function serverSummary(server: ScannedServer): string {
  if (server.transport === 'stdio') {
    return [server.commandKey ?? server.command ?? '', ...(server.args ?? [])].join(' ');
  }
  return `${server.transport.toUpperCase()} ${server.url ?? ''}`;
}

function serverNames(server: ScannedServer): string | null {
  const env = server.envNames ?? [];
  const headers = server.headerNames ?? [];
  if (env.length) return `Environment variables: ${env.join(', ')}`;
  if (headers.length) return `Headers: ${headers.join(', ')}`;
  return null;
}

export function MCPServerImport({
  scan,
  servers,
  dismissed,
  onDismiss,
  onImport,
}: MCPServerImportProps) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);

  // The read ends after an await: by then the panel can be gone (Preferences closed), and the
  // servers can have changed in the tab. So the result goes to the latest onImport, which
  // merges into the latest servers, and is dropped after unmount.
  const onImportRef = useRef(onImport);
  useEffect(() => {
    onImportRef.current = onImport;
  });
  const readRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      readRef.current?.abort();
      readRef.current = null;
    },
    []
  );

  const rows = buildImportRows(scan, servers);
  const importable = importableRows(rows);
  const selectedRows = importable.filter((row) => selected.has(row.sameKey));
  const badFiles = scan.files.filter(
    (file) => file.status === 'too-large' || file.status === 'unreadable'
  );

  const close = () => {
    setOpen(false);
    setSelected(new Set());
    setError(null);
  };

  const toggle = (row: ImportRow) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.sameKey)) next.delete(row.sameKey);
      else next.add(row.sameKey);
      return next;
    });

  const runImport = async () => {
    if (selectedRows.length === 0 || importing) return;
    const controller = new AbortController();
    readRef.current = controller;
    setImporting(true);
    setError(null);
    try {
      const read = await readMCPImport(
        selectedRows.map((row) => row.key),
        controller.signal
      );
      if (controller.signal.aborted) return;
      const byKey = new Map(selectedRows.map((row) => [row.key, row]));
      const configs: MCPServerConfig[] = [];
      for (const { key, config } of read.servers) {
        const row = byKey.get(key);
        if (!row) continue;
        // The name that the list showed; always off, with an id of this app
        configs.push({
          ...config,
          id: generateMCPServerId(),
          name: row.importName,
          enabled: false,
        });
      }
      if (configs.length) onImportRef.current(configs);
      const lines = configs.length
        ? [
            `Imported ${plural(configs.length, 'server', 'servers')}. They are off: turn on the ones that you want.`,
          ]
        : [];
      for (const { key, reason } of read.skipped) {
        lines.push(`${byKey.get(key)?.importName ?? 'A server'} was not imported. ${reason}`);
      }
      setResult(lines);
      close();
    } catch {
      if (!controller.signal.aborted) setError('Could not read the files. Try again.');
    } finally {
      if (readRef.current === controller) readRef.current = null;
      if (!controller.signal.aborted) setImporting(false);
    }
  };

  const resultText = result && result.length > 0 && (
    <div role="status" className="space-y-1 text-xs text-muted-foreground text-left">
      {result.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );

  if (!open) {
    if (importable.length === 0 || !hasNewImports(rows, dismissed)) return resultText || null;
    return (
      <div className="space-y-2 text-left">
        {resultText}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
          <p className="flex-1 min-w-40 text-sm">{importLineText(rows)}</p>
          <Button variant="outline" size="sm" className={BUTTON} onClick={() => setOpen(true)}>
            Import
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={BUTTON}
            onClick={() => onDismiss(importable.map((row) => row.dismissKey))}
          >
            Not now
          </Button>
        </div>
      </div>
    );
  }

  const headingId = `${baseId}-heading`;
  const allSelected = importable.length > 0 && selectedRows.length === importable.length;

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border text-left">
      <div className="px-3 pt-3 pb-2 space-y-0.5">
        <h5 id={headingId} className="text-sm font-medium">
          Import servers from other tools
        </h5>
        <p className="text-xs text-muted-foreground">
          Imported servers are off. Turn on the ones that you want.
        </p>
      </div>
      <div className="max-h-80 overflow-y-auto border-y border-border/50 px-3 py-2 space-y-3">
        {MCP_IMPORT_TOOLS.map((tool) => {
          const toolRows = rows.filter((row) => row.tool === tool.id);
          const files = badFiles.filter((file) => file.tool === tool.id);
          if (toolRows.length === 0 && files.length === 0) return null;
          const toolHeadingId = `${baseId}-${tool.id}`;
          return (
            <div key={tool.id} role="group" aria-labelledby={toolHeadingId} className="space-y-1">
              <h6 id={toolHeadingId} className="text-xs font-medium text-muted-foreground">
                {tool.label}
              </h6>
              {files.map((file) => (
                <p key={file.file} className="text-xs text-status-warn">
                  <span className="font-mono">{file.file}</span>:{' '}
                  {FILE_STATUS_TEXT[file.status as 'too-large' | 'unreadable']}
                </p>
              ))}
              <ul className="space-y-1">
                {toolRows.map((row) => (
                  <ImportListRow
                    key={row.sameKey}
                    row={row}
                    id={`${baseId}-row-${rows.indexOf(row)}`}
                    checked={selected.has(row.sameKey)}
                    onToggle={() => toggle(row)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {error && (
          <p role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={BUTTON}
          disabled={allSelected || importable.length === 0}
          onClick={() => setSelected(new Set(importable.map((row) => row.sameKey)))}
        >
          Select all
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className={BUTTON} disabled={importing} onClick={close}>
          Cancel
        </Button>
        <Button
          size="sm"
          className={BUTTON}
          disabled={selectedRows.length === 0 || importing}
          onClick={runImport}
        >
          {importing ? 'Importing…' : `Import ${plural(selectedRows.length, 'server', 'servers')}`}
        </Button>
      </div>
    </section>
  );
}

function ImportListRow({
  row,
  id,
  checked,
  onToggle,
}: {
  row: ImportRow;
  id: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const detailsId = `${id}-details`;
  const foundIn = foundInText(row);
  const names = serverNames(row.server);
  const title = <span className="block text-sm font-medium break-all">{row.importName}</span>;
  const line = (text: string, className = '') => (
    <span className={`block ${className}`}>{text}</span>
  );
  const details = (
    <span id={detailsId} className="block space-y-0.5 text-xs text-muted-foreground">
      {line(serverSummary(row.server), 'font-mono break-all')}
      {names && line(names)}
      {foundIn && line(foundIn)}
      {row.importName !== row.server.name &&
        line(`Named ${row.server.name} in the file. Another server already uses that name.`)}
      {row.state === 'added' && line('Already added')}
      {row.state === 'blocked' && line(`Cannot run: ${row.reason}`, 'text-status-warn')}
      {row.note && line(row.note)}
    </span>
  );

  if (row.state !== 'importable') {
    return (
      <li className="flex items-start gap-3 py-1 pl-7">
        <span className="block min-w-0 space-y-0.5">
          {title}
          {details}
        </span>
      </li>
    );
  }
  return (
    <li>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm py-1 hover:bg-muted/50"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-describedby={detailsId}
          className="mt-1 h-4 w-4 shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="min-w-0 space-y-0.5">
          {title}
          {details}
        </span>
      </label>
    </li>
  );
}
