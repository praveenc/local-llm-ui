import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MCPHTTPConfig, MCPServerConfig, MCPStdioConfig } from '../../../types/mcp';
import { MCPServerCheck } from '../MCPServerCheck';

const local: MCPStdioConfig = {
  id: 's1',
  name: 'Local one',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'pkg'],
  env: { TOKEN: 'abc' },
};

const remote: MCPHTTPConfig = {
  id: 's2',
  name: 'Remote one',
  enabled: true,
  transport: 'http',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer x' },
};

const names = (n: number) => Array.from({ length: n }, (_, i) => `tool${i + 1}`);

const answer = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

const connected = (tools: string[]) =>
  answer({ servers: [{ name: 'x', id: 's1', status: 'connected', tools }] });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const checkButton = () => screen.getByRole('button', { name: /^(Check|Checking…)$/ });

describe('MCPServerCheck', () => {
  it('posts only this server, also when it is disabled', async () => {
    fetchMock.mockReturnValue(connected(['a']));
    const user = userEvent.setup();
    const disabled = { ...local, enabled: false };
    render(<MCPServerCheck config={disabled} />);
    await user.click(checkButton());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bedrock-aisdk/mcp-status');
    expect(JSON.parse(init.body as string)).toEqual({ mcpServers: [disabled] });
    await screen.findByText('Connected · 1 tool');
  });

  it('says Checking… and disables the button while the check runs', async () => {
    let finish: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
    await act(async () => {
      finish({ ok: true, json: () => Promise.resolve({ servers: [] }) } as Response);
    });
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled();
  });

  it('shows the number of tools, with the singular for one tool', async () => {
    fetchMock.mockReturnValueOnce(connected(names(3))).mockReturnValueOnce(connected(['only']));
    const user = userEvent.setup();
    render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    const plural = await screen.findByText('Connected · 3 tools');
    expect(plural.closest('p')).toHaveClass('text-status-ok');
    expect(screen.getByText('tool1, tool2, tool3')).toHaveClass('text-[10px]');
    await user.click(checkButton());
    expect(await screen.findByText('Connected · 1 tool')).toBeInTheDocument();
    expect(screen.queryByText('Connected · 3 tools')).not.toBeInTheDocument();
  });

  it('hides the icons from screen readers', async () => {
    fetchMock.mockReturnValue(connected(['a']));
    const user = userEvent.setup();
    const { container } = render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    await screen.findByText('Connected · 1 tool');
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('cuts the tool names after 10 and counts the rest', async () => {
    fetchMock.mockReturnValue(connected(names(13)));
    const user = userEvent.setup();
    render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    await screen.findByText('Connected · 13 tools');
    expect(screen.getByText(`${names(10).join(', ')} and 3 more`)).toBeInTheDocument();
    expect(screen.queryByText(/tool11/)).not.toBeInTheDocument();
  });

  it('shows the error text of the server in the error colour', async () => {
    const message =
      'The server stopped before it answered (exit code 1): npm error code E401 ' +
      'npm error 401 Unauthorized - GET https://registry.example.com/@scope%2fpkg';
    fetchMock.mockReturnValue(
      answer({ servers: [{ name: 'x', id: 's1', status: 'error', tools: [], error: message }] })
    );
    const user = userEvent.setup();
    const { container } = render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    const text = await screen.findByText(message);
    expect(text.closest('p')).toHaveClass('text-destructive');
    // A long npm line must wrap, not make the dialog scroll sideways
    expect(text).toHaveClass('break-words');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['an empty list', { servers: [] }, true],
    ['a failed request', {}, false],
  ])('says the check did not finish for %s', async (_label, body, ok) => {
    fetchMock.mockReturnValue(answer(body, ok));
    const user = userEvent.setup();
    render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    const text = await screen.findByText(
      'The check did not finish. Look at the terminal that runs npm run dev.'
    );
    expect(text.closest('p')).toHaveClass('text-destructive');
  });

  it('puts the result in a polite live region', async () => {
    fetchMock.mockReturnValue(connected(['a']));
    const user = userEvent.setup();
    render(<MCPServerCheck config={local} />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toBeInTheDocument();
    await user.click(checkButton());
    const text = await screen.findByText('Connected · 1 tool');
    expect(region).toContainElement(text);
  });

  it.each([
    ['a local server with no command', { ...local, command: ' ' }],
    ['a local server with no name', { ...local, name: '' }],
    ['a remote server with no URL', { ...remote, url: '' }],
    ['a remote server with a broken URL', { ...remote, url: 'not a url' }],
  ] as Array<[string, MCPServerConfig]>)('disables the button for %s', async (_label, config) => {
    const user = userEvent.setup();
    render(<MCPServerCheck config={config} />);
    const button = checkButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Fill in the form to check this server.');
    await user.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows no hint for a complete server', () => {
    render(<MCPServerCheck config={local} />);
    expect(checkButton()).toBeEnabled();
    expect(checkButton()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Fill in the form to check this server.')).not.toBeInTheDocument();
  });

  describe('when the form changes', () => {
    const checked = async (config: MCPServerConfig) => {
      fetchMock.mockReturnValue(connected(['a', 'b']));
      const user = userEvent.setup();
      const view = render(<MCPServerCheck config={config} />);
      await user.click(checkButton());
      await screen.findByText('Connected · 2 tools');
      return view;
    };

    it.each([
      ['arguments', { ...local, args: ['-y', 'other'] }],
      ['the command', { ...local, command: 'uvx' }],
      ['an environment variable', { ...local, env: { TOKEN: 'new' } }],
    ] as Array<[string, MCPServerConfig]>)('clears the result when %s change', async (_l, next) => {
      const { rerender } = await checked(local);
      rerender(<MCPServerCheck config={next} />);
      expect(screen.queryByText('Connected · 2 tools')).not.toBeInTheDocument();
      expect(checkButton()).toBeEnabled();
    });

    it('clears the result when the URL or the headers of a remote server change', async () => {
      const { rerender } = await checked(remote);
      rerender(<MCPServerCheck config={{ ...remote, url: 'https://example.com/other' }} />);
      expect(screen.queryByText('Connected · 2 tools')).not.toBeInTheDocument();
    });

    it('clears the result when the headers of a remote server change', async () => {
      const { rerender } = await checked(remote);
      rerender(<MCPServerCheck config={{ ...remote, headers: {} }} />);
      expect(screen.queryByText('Connected · 2 tools')).not.toBeInTheDocument();
    });

    it('does not bring the old result back when the value is typed back', async () => {
      const { rerender } = await checked(local);
      rerender(<MCPServerCheck config={{ ...local, args: ['-y'] }} />);
      rerender(<MCPServerCheck config={local} />);
      expect(screen.queryByText('Connected · 2 tools')).not.toBeInTheDocument();
    });

    it('keeps the result when the name, the description, or enabled change', async () => {
      const { rerender } = await checked(local);
      rerender(<MCPServerCheck config={{ ...local, name: 'Renamed' }} />);
      rerender(<MCPServerCheck config={{ ...local, name: 'Renamed', description: 'About' }} />);
      rerender(<MCPServerCheck config={{ ...local, enabled: false }} />);
      expect(screen.getByText('Connected · 2 tools')).toBeInTheDocument();
    });

    it('aborts a check that runs when the arguments change, and ignores its answer', async () => {
      let signal: AbortSignal | undefined;
      let finish: (value: Response) => void = () => undefined;
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => (finish = resolve));
      });
      const user = userEvent.setup();
      const { rerender } = render(<MCPServerCheck config={local} />);
      await user.click(checkButton());
      expect(signal?.aborted).toBe(false);
      rerender(<MCPServerCheck config={{ ...local, args: ['-y', 'other'] }} />);
      expect(signal?.aborted).toBe(true);
      expect(checkButton()).toBeEnabled();
      // The old answer comes late and must not show
      await act(async () => {
        finish({
          ok: true,
          json: () =>
            Promise.resolve({
              servers: [{ name: 'x', id: 's1', status: 'connected', tools: ['late'] }],
            }),
        } as Response);
      });
      expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
      expect(screen.queryByText(/did not finish/)).not.toBeInTheDocument();
    });

    it('does not abort a check that runs when only the name changes', async () => {
      let signal: AbortSignal | undefined;
      let finish: (value: Response) => void = () => undefined;
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => (finish = resolve));
      });
      const user = userEvent.setup();
      const { rerender } = render(<MCPServerCheck config={local} />);
      await user.click(checkButton());
      rerender(<MCPServerCheck config={{ ...local, name: 'Renamed' }} />);
      expect(signal?.aborted).toBe(false);
      expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
      await act(async () => {
        finish({
          ok: true,
          json: () =>
            Promise.resolve({
              servers: [{ name: 'x', id: 's1', status: 'connected', tools: ['a'] }],
            }),
        } as Response);
      });
      await waitFor(() => expect(screen.getByText('Connected · 1 tool')).toBeInTheDocument());
    });
  });

  it('aborts a check that runs when the form closes', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const user = userEvent.setup();
    const { unmount } = render(<MCPServerCheck config={local} />);
    await user.click(checkButton());
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
