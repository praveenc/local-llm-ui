import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useState } from 'react';

import type { MCPHTTPConfig, MCPServersMap } from '../../../types/mcp';
import { MCPServerSettings } from '../MCPServerSettings';

const remote: MCPHTTPConfig = {
  id: 's2',
  name: 'Remote one',
  enabled: true,
  transport: 'http',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer x' },
};

const servers: MCPServersMap = {
  s1: {
    id: 's1',
    name: 'Local one',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { TOKEN: 'abc' },
  },
  s2: remote,
};

const setup = (value: MCPServersMap = servers) => {
  const onChange = vi.fn();
  render(<MCPServerSettings servers={value} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
};

describe('MCPServerSettings accessibility', () => {
  it('toggles the server header with the keyboard and exposes aria-expanded', async () => {
    const { user } = setup();
    const header = screen.getByRole('button', { name: 'Local one' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    header.focus();
    await user.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(header.getAttribute('aria-controls')!)).toBeInTheDocument();
    await user.keyboard(' ');
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('links every stdio field to its label and names the row controls', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Local one' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Local one');
    expect(screen.getByLabelText('Transport')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Command')).toHaveValue('npx');
    expect(screen.getByLabelText('Argument 2')).toHaveValue('pkg');
    expect(screen.getByLabelText('Environment variable name 1')).toHaveValue('TOKEN');
    expect(screen.getByLabelText('Environment variable value 1')).toHaveValue('abc');
    expect(screen.getByRole('button', { name: 'Remove argument 2' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove environment variable TOKEN' })
    ).toBeInTheDocument();
  });

  it('links remote fields and names header rows', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    expect(screen.getByLabelText('URL')).toHaveValue('https://example.com/mcp');
    expect(screen.getByLabelText('Header name 1')).toHaveValue('Authorization');
    expect(screen.getByLabelText('Header value 1')).toHaveValue('Bearer x');
    expect(screen.getByRole('button', { name: 'Remove header Authorization' })).toBeInTheDocument();
  });

  it('keeps ids unique when two servers are open', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Local one' }));
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    expect(screen.getAllByLabelText('Name')).toHaveLength(2);
  });

  it('falls back to the row number when the header name is empty', async () => {
    const { user } = setup({
      s2: { ...remote, headers: { '': 'v' } },
    });
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    expect(screen.getByRole('button', { name: 'Remove header 1' })).toBeInTheDocument();
  });

  it('shows a saved server error under its field and flags the field', async () => {
    const { user } = setup({
      s2: { ...remote, url: '' },
    });
    expect(screen.getByRole('img', { name: 'URL is required' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    expect(screen.getByText('URL is required')).toBeVisible();
    const url = screen.getByLabelText('URL');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription('URL is required');
  });

  it('waits until the user leaves the field before flagging a new server', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<MCPServerSettings servers={{}} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add Remote Server/ }));
    const added = onChange.mock.calls[0][0] as MCPServersMap;
    rerender(<MCPServerSettings servers={added} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'New Remote Server' }));
    const url = screen.getByLabelText('URL');
    expect(url).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('URL is required')).not.toBeInTheDocument();
    url.focus();
    await user.tab();
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription('URL is required');
  });

  it('keeps a header row and its focus while the name is typed', async () => {
    // Stateful harness: the real parent stores the servers and passes them back
    const Harness = () => {
      const [value, setValue] = useState<MCPServersMap>({ s2: { ...remote, headers: {} } });
      return <MCPServerSettings servers={value} onChange={setValue} />;
    };
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    const name = screen.getByLabelText('Header name 1');
    expect(name).toHaveFocus();
    expect(name).toHaveValue('');
    await user.keyboard('Authorization');
    expect(screen.getByLabelText('Header name 1')).toBe(name);
    expect(name).toHaveFocus();
    expect(name).toHaveValue('Authorization');
    await user.clear(name);
    await user.type(name, 'X-Id');
    expect(name).toHaveFocus();
    expect(name).toHaveValue('X-Id');
  });

  it('saves only rows with a unique, non-empty name', async () => {
    const onChange = vi.fn();
    render(<MCPServerSettings servers={{ s2: { ...remote, headers: {} } }} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    const lastHeaders = () => (onChange.mock.calls.at(-1)![0] as MCPServersMap).s2 as MCPHTTPConfig;
    expect(lastHeaders().headers).toEqual({});
    await user.type(screen.getByLabelText('Header name 1'), 'A');
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getByLabelText('Header name 2'), 'A');
    expect(lastHeaders().headers).toEqual({ A: '' });
    expect(screen.getByLabelText('Header name 2')).toHaveAccessibleDescription(
      'This name is used twice; only the first one is saved.'
    );
  });

  it('describes an environment variable row error (a label with a space)', async () => {
    const stdio = servers.s1;
    render(
      <MCPServerSettings
        servers={{ s1: { ...stdio, env: {} } as MCPServersMap[string] }}
        onChange={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Local one' }));
    await user.click(screen.getByRole('button', { name: 'Add environment variable' }));
    await user.type(screen.getByLabelText('Environment variable value 1'), 'abc');
    expect(screen.getByLabelText('Environment variable name 1')).toHaveAccessibleDescription(
      'Add a name, or this row is not saved.'
    );
  });

  it('says a row with a value but no name is not saved', async () => {
    const onChange = vi.fn();
    render(<MCPServerSettings servers={{ s2: { ...remote, headers: {} } }} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getByLabelText('Header value 1'), 'secret');
    expect(screen.getByLabelText('Header name 1')).toHaveAccessibleDescription(
      'Add a name, or this row is not saved.'
    );
  });

  it('gives the enable and remove buttons real names', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Disable server Local one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove server Local one' })).toBeInTheDocument();
  });
});
