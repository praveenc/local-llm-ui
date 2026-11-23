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
});
