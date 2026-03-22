/**
 * MCPToolsIndicator Component
 *
 * Toolbar button that shows MCP server connectivity and available tools
 * in a popover. Fetches status on mount and when preferences change.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug2 } from 'lucide-react';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MCPServerConfig } from '@/types/mcp';
import { PREFERENCES_CHANGED_EVENT, loadPreferences } from '@/utils/preferences';

interface MCPServerStatus {
  name: string;
  id: string;
  status: 'connected' | 'error';
  tools: string[];
  error?: string;
}

interface MCPToolsIndicatorProps {
  disabled?: boolean;
}

const MCP_STATUS_QUERY_KEY = ['mcp-status'] as const;

export function MCPToolsIndicator({ disabled }: MCPToolsIndicatorProps) {
  const queryClient = useQueryClient();
  const [enabledConfigs, setEnabledConfigs] = useState<MCPServerConfig[]>([]);
  const [configVersion, setConfigVersion] = useState(0);

  const refreshConfigs = useCallback(() => {
    const prefs = loadPreferences();
    const mcpMap = prefs.mcpServers ?? {};
    const enabled = Object.values(mcpMap).filter((server) => server.enabled);

    setEnabledConfigs(enabled);
    setConfigVersion((previous) => previous + 1);

    if (enabled.length === 0) {
      queryClient.removeQueries({ queryKey: MCP_STATUS_QUERY_KEY });
    }
  }, [queryClient]);

  useEffect(() => {
    refreshConfigs();

    const handler = () => {
      refreshConfigs();
    };

    window.addEventListener('storage', handler);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, handler);

    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, handler);
    };
  }, [refreshConfigs]);

  const enabledServerKey = useMemo(
    () => enabledConfigs.map(({ id, transport }) => ({ id, transport })),
    [enabledConfigs]
  );

  const hasServers = enabledConfigs.length > 0;

  const statusQuery = useQuery({
    queryKey: [...MCP_STATUS_QUERY_KEY, configVersion, enabledServerKey],
    enabled: hasServers,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<MCPServerStatus[]> => {
      const prefs = loadPreferences();
      const latestEnabledConfigs = Object.values(prefs.mcpServers ?? {}).filter(
        (server): server is MCPServerConfig => server.enabled
      );

      if (latestEnabledConfigs.length === 0) {
        return [];
      }

      try {
        const response = await fetch('/api/bedrock-aisdk/mcp-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: latestEnabledConfigs }),
        });

        if (!response.ok) {
          return [];
        }

        const data = (await response.json()) as { servers?: MCPServerStatus[] };
        return data.servers ?? [];
      } catch {
        return [];
      }
    },
  });

  const servers = hasServers ? (statusQuery.data ?? []) : [];
  const loading = hasServers && statusQuery.isFetching;
  const totalTools = servers.reduce((sum, server) => sum + server.tools.length, 0);
  const connectedCount = servers.filter((server) => server.status === 'connected').length;

  if (!hasServers) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground/50 cursor-default"
              disabled
            >
              <Plug2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>No MCP servers configured</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 px-2 relative',
                  connectedCount > 0
                    ? 'text-purple-500 hover:text-purple-600 bg-purple-500/10 hover:bg-purple-500/20'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                disabled={disabled || loading}
              >
                <Plug2 className="h-4 w-4" />
                {totalTools > 0 && (
                  <Badge
                    variant="secondary"
                    className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[10px] leading-none font-mono"
                  >
                    {totalTools}
                  </Badge>
                )}
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
                    server.status === 'connected' ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                <span className="text-sm font-medium truncate">{server.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}
                </span>
              </div>

              {server.error && <p className="text-xs text-red-500 ml-4">{server.error}</p>}

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
