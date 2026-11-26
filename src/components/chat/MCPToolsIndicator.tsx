/**
 * MCPToolsIndicator Component
 *
 * Toolbar button that shows MCP server connectivity and available tools
 * in a popover. A check starts each local server, so it runs only on mount, when the window gets
 * MCP_SERVERS_CHECK_EVENT (Preferences closed), and when the popover opens. A change of the
 * preferences does not check: the user may still be typing a command.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug2 } from 'lucide-react';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fetchMCPServerStatus } from '@/services/mcpStatus';
import type { MCPServerConfig } from '@/types/mcp';
import { MCP_SERVERS_CHECK_EVENT, checkableServers } from '@/utils/mcpServers';
import { PREFERENCES_CHANGED_EVENT, loadPreferences } from '@/utils/preferences';

import {
  TOOLS_UNSUPPORTED_TEXT,
  composerActive,
  composerChip,
  composerIconButton,
} from './composerStyles';

interface MCPToolsIndicatorProps {
  disabled?: boolean;
  /** False when the selected model cannot use tools: the request sends no MCP servers */
  toolsSupported?: boolean;
}

const MCP_STATUS_QUERY_KEY = ['mcp-status'] as const;

function getCheckableConfigs(): MCPServerConfig[] {
  return checkableServers(loadPreferences().mcpServers);
}

export function MCPToolsIndicator({ disabled, toolsSupported = true }: MCPToolsIndicatorProps) {
  const queryClient = useQueryClient();
  const [enabledConfigs, setEnabledConfigs] = useState<MCPServerConfig[]>(getCheckableConfigs);

  const hasServers = enabledConfigs.length > 0;

  // A fixed key and no automatic fetch: the checks below are the only ones
  const statusQuery = useQuery({
    queryKey: MCP_STATUS_QUERY_KEY,
    enabled: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: ({ signal }) => fetchMCPServerStatus(getCheckableConfigs(), signal),
  });
  const { refetch } = statusQuery;

  const refreshConfigs = useCallback(() => {
    const checkable = getCheckableConfigs();

    setEnabledConfigs(checkable);

    if (checkable.length === 0) {
      queryClient.removeQueries({ queryKey: MCP_STATUS_QUERY_KEY });
    }
  }, [queryClient]);

  const check = useCallback(() => {
    if (getCheckableConfigs().length === 0) return;
    void refetch();
  }, [refetch]);

  // The page load
  useEffect(() => {
    check();
    // Once: later checks have their own triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // These change which servers count (the button shows or hides), but never start a server
    window.addEventListener('storage', refreshConfigs);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, refreshConfigs);

    const handleCheck = () => {
      refreshConfigs();
      check();
    };
    window.addEventListener(MCP_SERVERS_CHECK_EVENT, handleCheck);

    return () => {
      window.removeEventListener('storage', refreshConfigs);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, refreshConfigs);
      window.removeEventListener(MCP_SERVERS_CHECK_EVENT, handleCheck);
    };
  }, [refreshConfigs, check]);

  const servers = hasServers ? (statusQuery.data ?? []) : [];
  const loading = hasServers && statusQuery.isFetching;
  const totalTools = servers.reduce((sum, server) => sum + server.tools.length, 0);
  const connectedCount = servers.filter((server) => server.status === 'connected').length;

  if (!hasServers || !toolsSupported) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(composerIconButton, 'cursor-default opacity-50 hover:bg-transparent')}
              type="button"
              // Stays focusable so the tooltip can say why it does nothing
              aria-disabled
              aria-label="MCP tools"
            >
              <Plug2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {toolsSupported
                ? 'No MCP servers configured. Add one in Preferences, MCP Servers'
                : TOOLS_UNSUPPORTED_TEXT}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) check();
      }}
    >
      <TooltipProvider>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  totalTools > 0
                    ? cn(composerChip, 'gap-1 px-2.5 has-[>svg]:px-2.5')
                    : composerIconButton,
                  connectedCount > 0 && composerActive
                )}
                disabled={disabled || loading}
                aria-label={`MCP tools: ${totalTools}`}
              >
                <Plug2 className="size-4" />
                {totalTools > 0 && <span className="text-xs tabular-nums">{totalTools}</span>}
              </Button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent>
            <p>
              {loading
                ? 'Checking MCP servers…'
                : `${connectedCount}/${enabledConfigs.length} MCP servers · ${totalTools} tools`}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        className="w-[320px] max-h-[400px] overflow-y-auto p-3 z-[1100]"
        align="start"
        side="top"
      >
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">MCP Servers</h4>

          {servers.map((server) => (
            <div key={server.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    server.status === 'connected' ? 'bg-status-ok' : 'bg-status-error'
                  )}
                />
                <span className="text-sm font-medium truncate">{server.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}
                </span>
              </div>

              {server.error && <p className="text-xs text-destructive ml-4">{server.error}</p>}

              {server.tools.length > 0 && (
                <div className="ml-4 flex flex-wrap gap-1">
                  {server.tools.map((tool) => (
                    <span
                      key={tool}
                      className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="border-t pt-2 text-xs text-muted-foreground">
            {totalTools} total tool{totalTools !== 1 ? 's' : ''} across {connectedCount} connected
            server{connectedCount !== 1 ? 's' : ''}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
