/**
 * MCPToolsIndicator Component
 *
 * Toolbar button that shows MCP server connectivity and available tools
 * in a popover. Fetches status on mount and when preferences change.
 */
import { Plug2 } from 'lucide-react';

import { useCallback, useEffect, useState } from 'react';

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

export function MCPToolsIndicator({ disabled }: MCPToolsIndicatorProps) {
  const [servers, setServers] = useState<MCPServerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [enabledConfigs, setEnabledConfigs] = useState<MCPServerConfig[]>([]);

  // Load enabled MCP server configs from preferences
  const refreshConfigs = useCallback(() => {
    const prefs = loadPreferences();
    const mcpMap = prefs.mcpServers ?? {};
    const enabled = Object.values(mcpMap).filter((s) => s.enabled);
    setEnabledConfigs(enabled);
  }, []);

  // Load configs on mount and listen for storage changes (cross-tab)
  useEffect(() => {
    refreshConfigs();
    const handler = () => refreshConfigs();
    // Listen for both cross-tab (storage) and same-tab (custom event) changes
    window.addEventListener('storage', handler);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, handler);
    };
  }, [refreshConfigs]);

  // Fetch MCP status when enabled configs change
  useEffect(() => {
    if (enabledConfigs.length === 0) {
      setServers([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch('/api/bedrock-aisdk/mcp-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers: enabledConfigs }),
    })
      .then((r) => r.json())
      .then((data: { servers: MCPServerStatus[] }) => {
        if (!cancelled) setServers(data.servers ?? []);
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabledConfigs]);

  const totalTools = servers.reduce((sum, s) => sum + s.tools.length, 0);
  const connectedCount = servers.filter((s) => s.status === 'connected').length;
  const hasServers = enabledConfigs.length > 0;

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
