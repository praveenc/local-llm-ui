/**
 * MCPServerCheck
 *
 * The Check button of one MCP server in Preferences. It asks the server to connect to this one
 * server and shows the tools, or the reason it failed. It works for a disabled server too, so you
 * can check before you turn the server on.
 */
import { AlertCircle, Check } from 'lucide-react';

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchMCPServerStatus } from '@/services/mcpStatus';
import type { MCPServerStatus } from '@/services/mcpStatus';
import type { MCPServerConfig } from '@/types/mcp';
import { validateMCPServerConfig } from '@/types/mcp';
import { serverConnectionKey, summarizeToolNames } from '@/utils/mcpServers';

interface CheckState {
  /** The connection key that the check was made for */
  key: string;
  running: boolean;
  servers: MCPServerStatus[];
}

const CHECK_FAILED_MESSAGE =
  'The check did not finish. Look at the terminal that runs npm run dev.';
const INCOMPLETE_HINT = 'Fill in the form to check this server.';

function CheckResult({ servers }: { servers: MCPServerStatus[] }) {
  const status = servers[0];

  if (!status) {
    return (
      <p className="flex items-start gap-1 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{CHECK_FAILED_MESSAGE}</span>
      </p>
    );
  }

  if (status.status === 'error') {
    return (
      <p className="flex items-start gap-1 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{status.error || 'The server did not connect.'}</span>
      </p>
    );
  }

  const count = status.tools.length;
  return (
    <div className="space-y-0.5">
      <p className="flex items-start gap-1 text-xs text-status-ok">
        <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{`Connected · ${count} ${count === 1 ? 'tool' : 'tools'}`}</span>
      </p>
      {count > 0 && (
        <p className="text-[10px] text-muted-foreground break-words">
          {summarizeToolNames(status.tools)}
        </p>
      )}
    </div>
  );
}

export function MCPServerCheck({ config }: { config: MCPServerConfig }) {
  const hintId = useId();
  const key = serverConnectionKey(config);
  const incomplete = validateMCPServerConfig(config) !== null;
  const [check, setCheck] = useState<CheckState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // A change of what starts or reaches the server makes the result old: drop it and stop a check
  // that runs. The same cleanup stops a check when the form closes.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setCheck(null);
    },
    [key]
  );

  const current = check && check.key === key ? check : null;
  const running = current?.running ?? false;
  const blocked = incomplete || running;

  const run = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setCheck({ key, running: true, servers: [] });
    const servers = await fetchMCPServerStatus([config], { signal: controller.signal });
    // The fields changed or the form closed while the check ran: this answer is not for them
    if (controller.signal.aborted) return;
    setCheck({ key, running: false, servers });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (!blocked) void run();
          }}
          // Not `disabled`: the button keeps the focus while it runs, and stays focusable when
          // the form is incomplete, so a screen reader reads the hint
          aria-disabled={blocked || undefined}
          aria-describedby={incomplete ? hintId : undefined}
          className={cn('h-7 text-xs', blocked && 'cursor-default opacity-50 hover:bg-transparent')}
        >
          {running ? 'Checking…' : 'Check'}
        </Button>
        {incomplete && (
          <p id={hintId} className="text-[10px] text-muted-foreground">
            {INCOMPLETE_HINT}
          </p>
        )}
      </div>
      <div aria-live="polite">
        {current && !current.running && <CheckResult servers={current.servers} />}
      </div>
    </div>
  );
}
