import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { useState } from 'react';

import type { MCPHTTPConfig, MCPServersMap, MCPStdioConfig } from '../../../types/mcp';
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
  // jsdom has no pointer capture or scrollIntoView, which the Radix Select needs
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => undefined;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
  });

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
    // Fill in the name, so the URL is the first field with an error
    for (const server of Object.values(added)) server.name = 'remote';
    rerender(<MCPServerSettings servers={added} onChange={onChange} />);
    // The new server is already open
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
      expect.stringContaining('Add a name, or this row is not saved.')
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

  describe('new server form', () => {
    // Stateful harness: the parent keeps the servers and passes them back
    const Harness = ({ initial = {} }: { initial?: MCPServersMap }) => {
      const [value, setValue] = useState<MCPServersMap>(initial);
      return <MCPServerSettings servers={value} onChange={setValue} />;
    };

    const addLocal = async () => {
      render(<Harness />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Add Local Server/ }));
      return user;
    };

    it('adds a local server with an empty name, open, with the cursor in Name', async () => {
      await addLocal();
      const name = screen.getByLabelText('Name');
      expect(name).toHaveValue('');
      expect(name).toHaveAttribute('placeholder', 'my-server');
      expect(name).toHaveFocus();
    });

    it('adds a remote server with an empty name', async () => {
      render(<Harness />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Add Remote Server/ }));
      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Name')).toHaveFocus();
      expect(screen.getByRole('button', { name: 'New remote server' })).toBeInTheDocument();
    });

    it('shows a muted fallback in the header and in the button names while the name is empty', async () => {
      await addLocal();
      const header = screen.getByRole('button', { name: 'New local server' });
      expect(header).toHaveTextContent('New local server');
      expect(within(header).getByText('New local server')).toHaveClass('text-muted-foreground');
      expect(
        screen.getByRole('button', { name: 'Disable server New local server' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Remove server New local server' })
      ).toBeInTheDocument();
      expect(screen.queryByText('Untitled')).not.toBeInTheDocument();
    });

    it('uses the typed name in the header once there is text', async () => {
      const user = await addLocal();
      await user.type(screen.getByLabelText('Name'), 'files');
      const header = screen.getByRole('button', { name: 'files' });
      expect(within(header).getByText('files')).not.toHaveClass('text-muted-foreground');
    });

    it('treats a name of spaces as empty', async () => {
      const user = await addLocal();
      await user.type(screen.getByLabelText('Name'), '   ');
      expect(screen.getByRole('button', { name: 'New local server' })).toBeInTheDocument();
    });

    it('keeps the empty name when the transport changes', async () => {
      const user = await addLocal();
      await user.click(screen.getByLabelText('Transport'));
      await user.click(screen.getByRole('option', { name: /HTTP/ }));
      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'New remote server' })).toBeInTheDocument();
    });

    it('shows the name error only after the user leaves the field', async () => {
      const user = await addLocal();
      const name = screen.getByLabelText('Name');
      expect(screen.queryByText('Server name is required')).not.toBeInTheDocument();
      await user.tab();
      expect(screen.getByText('Server name is required')).toBeVisible();
      expect(name).toHaveAccessibleDescription('Server name is required');
    });

    it('does not move the focus when the form is closed and opened again', async () => {
      const user = await addLocal();
      const header = screen.getByRole('button', { name: 'New local server' });
      await user.click(header);
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      await user.click(header);
      expect(screen.getByLabelText('Name')).not.toHaveFocus();
      expect(header).toHaveFocus();
    });

    it('starts a saved server closed', () => {
      setup();
      expect(screen.getByRole('button', { name: 'Local one' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    });
  });

  describe('local server hints', () => {
    const open = async (stdio: MCPServersMap[string] = servers.s1) => {
      const onChange = vi.fn();
      render(<MCPServerSettings servers={{ s1: stdio }} onChange={onChange} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: stdio.name }));
      return { onChange, user };
    };
    const stdio = (patch: Partial<MCPStdioConfig>): MCPStdioConfig => ({
      ...(servers.s1 as MCPStdioConfig),
      ...patch,
    });

    it('describes the command', async () => {
      await open();
      const command = screen.getByLabelText('Command');
      expect(command).toHaveAttribute('placeholder', 'npx, uvx, or the name or path of a program');
      expect(command).toHaveAccessibleDescription(
        'A program name on PATH, or a full path that starts with / or ~/. Put its arguments in the fields below.'
      );
    });

    it('describes each argument and gives the first two a real example', async () => {
      await open(stdio({ args: ['a', 'b', 'c'] }));
      const help =
        'One argument in each field, with no quotes. The app does not use a shell, so it passes each field as you type it.';
      expect(screen.getByLabelText('Argument 1')).toHaveAttribute('placeholder', '-y');
      expect(screen.getByLabelText('Argument 2')).toHaveAttribute('placeholder', 'package-name');
      expect(screen.getByLabelText('Argument 3')).toHaveAttribute('placeholder', 'Argument 3');
      for (const n of [1, 2, 3]) {
        expect(screen.getByLabelText(`Argument ${n}`)).toHaveAccessibleDescription(help);
      }
    });

    it('describes each environment name and value, with code for $VAR and ~', async () => {
      await open();
      const help =
        'One variable in each row, with no quotes. The app does not expand $VAR or ~: type the full value.';
      expect(screen.getByLabelText('Environment variable name 1')).toHaveAccessibleDescription(
        help
      );
      expect(screen.getByLabelText('Environment variable value 1')).toHaveAccessibleDescription(
        help
      );
      const group = screen.getByRole('group', { name: 'Environment Variables' });
      expect(Array.from(group.querySelectorAll('code')).map((c) => c.textContent)).toEqual([
        '$VAR',
        '~',
      ]);
    });

    it('uses NAME and value as the environment placeholders', async () => {
      await open();
      expect(screen.getByLabelText('Environment variable name 1')).toHaveAttribute(
        'placeholder',
        'NAME'
      );
      expect(screen.getByLabelText('Environment variable value 1')).toHaveAttribute(
        'placeholder',
        'value'
      );
    });

    it('does not describe header fields with the environment help', async () => {
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Remote one' }));
      expect(screen.getByLabelText('Header name 1')).not.toHaveAttribute('aria-describedby');
      expect(screen.getByLabelText('Header value 1')).not.toHaveAttribute('aria-describedby');
    });
  });

  describe('quote warning', () => {
    const warning = 'The quotes are part of this value. Remove them unless the server needs them.';
    const withArgs = (args: string[], env: Record<string, string> = {}) => ({
      s1: { ...(servers.s1 as MCPStdioConfig), args, env },
    });
    // Stateful, so that typing builds up the value as in the real parent
    const open = async (value: MCPServersMap) => {
      const onChange = vi.fn();
      const Stateful = () => {
        const [current, setCurrent] = useState(value);
        return (
          <MCPServerSettings
            servers={current}
            onChange={(next) => {
              onChange(next);
              setCurrent(next);
            }}
          />
        );
      };
      render(<Stateful />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Local one' }));
      return { onChange, user };
    };

    it.each(['"-y"', "'x'"])('warns under an argument that is %s', async (arg) => {
      await open(withArgs([arg]));
      const field = screen.getByLabelText('Argument 1');
      expect(screen.getByText(warning)).toBeVisible();
      expect(field).toHaveAccessibleDescription(expect.stringContaining(warning));
    });

    it.each(['-y', '"', 'a"b"'])('does not warn under an argument that is %s', async (arg) => {
      await open(withArgs([arg]));
      expect(screen.queryByText(warning)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Argument 1')).not.toHaveAccessibleDescription(
        expect.stringContaining(warning)
      );
    });

    it('warns under an environment value in quotes, and links it to the value field', async () => {
      await open(withArgs([], { TOKEN: '"abc"' }));
      expect(screen.getByText(warning)).toBeVisible();
      expect(screen.getByLabelText('Environment variable value 1')).toHaveAccessibleDescription(
        expect.stringContaining(warning)
      );
      expect(screen.getByLabelText('Environment variable name 1')).not.toHaveAccessibleDescription(
        expect.stringContaining(warning)
      );
    });

    it('marks the warning icon as decorative', async () => {
      await open(withArgs(['"x"']));
      const icon = screen.getByText(warning).querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('does not warn under a header value', async () => {
      const user = userEvent.setup();
      render(
        <MCPServerSettings
          servers={{ s2: { ...remote, headers: { Authorization: '"Bearer x"' } } }}
          onChange={vi.fn()}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Remote one' }));
      expect(screen.queryByText(warning)).not.toBeInTheDocument();
    });

    it('saves the value exactly as typed, with its quotes', async () => {
      const { onChange, user } = await open(withArgs(['']));
      await user.type(screen.getByLabelText('Argument 1'), '"-y"');
      const saved = (onChange.mock.calls.at(-1)![0] as MCPServersMap).s1 as MCPStdioConfig;
      expect(saved.args).toEqual(['"-y"']);
    });

    it('saves an environment value exactly as typed, with its quotes', async () => {
      const { onChange, user } = await open(withArgs([], { TOKEN: '' }));
      await user.type(screen.getByLabelText('Environment variable value 1'), "'abc'");
      const saved = (onChange.mock.calls.at(-1)![0] as MCPServersMap).s1 as MCPStdioConfig;
      expect(saved.env).toEqual({ TOKEN: "'abc'" });
    });
  });
});

describe('MCPServerSettings Check button', () => {
  const Harness = ({ initial }: { initial: MCPServersMap }) => {
    const [value, setValue] = useState<MCPServersMap>(initial);
    return <MCPServerSettings servers={value} onChange={setValue} />;
  };
  const answer = (tools: string[]) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({ servers: [{ name: 'x', id: 's1', status: 'connected', tools }] }),
    } as Response);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a Check button at the end of a local and of a remote server', async () => {
    const { user } = setup();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Local one' }));
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    expect(screen.getAllByRole('button', { name: 'Check' })).toHaveLength(2);
  });

  it('checks only the server whose button is clicked', async () => {
    const fetchMock = vi.fn().mockReturnValue(answer(['a', 'b']));
    vi.stubGlobal('fetch', fetchMock);
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Local one' }));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Connected · 2 tools')).toBeInTheDocument();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      mcpServers: Array<{ id: string }>;
    };
    expect(body.mcpServers.map((server) => server.id)).toEqual(['s1']);
  });

  it('clears the result when an argument changes, and keeps it when the name changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(answer(['a', 'b'])));
    render(<Harness initial={servers} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Local one' }));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Connected · 2 tools');

    await user.type(screen.getByLabelText('Name'), 'x');
    expect(screen.getByText('Connected · 2 tools')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Argument 2'), 'x');
    expect(screen.queryByText('Connected · 2 tools')).not.toBeInTheDocument();
  });

  it('disables Check for a server that is not filled in, and says why', async () => {
    const { user } = setup({ s2: { ...remote, url: '' } });
    await user.click(screen.getByRole('button', { name: 'Remote one' }));
    const button = screen.getByRole('button', { name: 'Check' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Fill in the form to check this server.');
  });
});
