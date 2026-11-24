import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
