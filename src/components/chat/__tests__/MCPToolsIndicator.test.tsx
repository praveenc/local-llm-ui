import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCP_SERVERS_CHECK_EVENT } from '../../../utils/mcpServers';
import { PREFERENCES_CHANGED_EVENT } from '../../../utils/preferences';
import { MCPToolsIndicator } from '../MCPToolsIndicator';

describe('MCPToolsIndicator', () => {
  beforeEach(() => localStorage.clear());

  it('stays focusable with no servers and does not submit the form', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <QueryClientProvider client={new QueryClient()}>
        <form onSubmit={onSubmit}>
          <MCPToolsIndicator />
        </form>
      </QueryClientProvider>
    );
    const button = screen.getByRole('button', { name: 'MCP tools' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says the model cannot use tools, also with servers configured', async () => {
    localStorage.setItem(
      'local-llm-ui-preferences',
      JSON.stringify({
        mcpServers: {
          s1: {
            id: 's1',
            name: 'Fetch',
            enabled: true,
            transport: 'stdio',
            command: 'uvx',
            args: [],
            env: {},
          },
        },
      })
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MCPToolsIndicator toolsSupported={false} />
      </QueryClientProvider>
    );
    const button = screen.getByRole('button', { name: 'MCP tools' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.focus(button);
    expect((await screen.findAllByText('This model cannot use tools')).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  describe('checks', () => {
    const STORAGE_KEY = 'local-llm-ui-preferences';
    const server = (id: string, patch: Record<string, unknown> = {}) => ({
      id,
      name: `Server ${id}`,
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      env: {},
      ...patch,
    });
    const store = (...servers: Array<Record<string, unknown>>) =>
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mcpServers: Object.fromEntries(servers.map((entry) => [entry.id, entry])),
        })
      );

    let fetchSpy: ReturnType<typeof vi.fn>;
    const bodies = () =>
      fetchSpy.mock.calls.map(
        (call) => JSON.parse((call[1] as { body: string }).body) as { mcpServers: unknown[] }
      );

    const renderIndicator = () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <MCPToolsIndicator />
        </QueryClientProvider>
      );
    const settle = () => waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());

    beforeEach(() => {
      fetchSpy = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          servers: [{ id: 'a', name: 'Server a', status: 'connected', tools: ['one', 'two'] }],
        }),
      }));
      vi.stubGlobal('fetch', fetchSpy);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('checks once when it mounts, with the complete enabled servers only', async () => {
      store(
        server('a'),
        server('empty-command', { command: '' }),
        server('no-name', { name: '' }),
        server('off', { enabled: false })
      );
      renderIndicator();
      await settle();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(bodies()[0].mcpServers).toEqual([server('a')]);
      expect(screen.getByRole('button', { name: 'MCP tools: 2' })).toBeInTheDocument();
    });

    it('does not check when the preferences or the storage change', async () => {
      store(server('a'));
      renderIndicator();
      await settle();
      fetchSpy.mockClear();

      // The user types a command that is not finished
      store(server('a'), server('b', { command: 'npx -y @scope/p' }));
      act(() => {
        window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
        window.dispatchEvent(new Event('storage'));
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('checks once after MCP_SERVERS_CHECK_EVENT, with the servers as they are then', async () => {
      store(server('a'));
      renderIndicator();
      await settle();
      fetchSpy.mockClear();

      store(server('a'), server('b'), server('c', { command: ' ' }));
      act(() => {
        window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
        window.dispatchEvent(new CustomEvent(MCP_SERVERS_CHECK_EVENT));
      });
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await settle();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(bodies()[0].mcpServers).toEqual([server('a'), server('b')]);
    });

    it('checks when the popover opens', async () => {
      store(server('a'));
      renderIndicator();
      await settle();
      fetchSpy.mockClear();

      fireEvent.click(screen.getByRole('button', { name: /MCP tools/ }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await settle();
      expect(await screen.findByText('MCP Servers')).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when no server is complete, and shows the empty state', async () => {
      store(server('half', { command: '' }), server('off', { enabled: false }));
      renderIndicator();
      act(() => {
        window.dispatchEvent(new CustomEvent(MCP_SERVERS_CHECK_EVENT));
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchSpy).not.toHaveBeenCalled();
      const button = screen.getByRole('button', { name: 'MCP tools' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
