import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useState } from 'react';

import type { MCPServerConfig, MCPServersMap } from '../../../types/mcp';
import type { MCPImportScan, ScannedServer } from '../../../utils/mcpImport';
import { MCPServerSettings } from '../MCPServerSettings';

const scanMCPImport = vi.fn<() => Promise<MCPImportScan>>();
const readMCPImport = vi.fn<(keys: string[], signal?: AbortSignal) => Promise<unknown>>();

vi.mock('../../../services/mcpImport', () => ({
  scanMCPImport: () => scanMCPImport(),
  readMCPImport: (keys: string[], signal?: AbortSignal) => readMCPImport(keys, signal),
}));

const local = (
  tool: string,
  name: string,
  command: string,
  args: string[] = []
): ScannedServer => ({
  key: `${tool}:rev:${name}`,
  name,
  transport: 'stdio',
  command,
  args,
  envNames: [],
  placeholders: 0,
});

const scanWith = (kiro: ScannedServer[], pi: ScannedServer[] = []): MCPImportScan => ({
  files: [
    { tool: 'kiro', label: 'Kiro', file: '~/.kiro/settings/mcp.json', status: 'ok', servers: kiro },
    { tool: 'pi', label: 'Pi', file: '~/.pi/agent/mcp.json', status: 'ok', servers: pi },
    {
      tool: 'claude-code',
      label: 'Claude Code',
      file: '~/.claude.json',
      status: 'too-large',
      servers: [],
    },
  ],
});

const BASE_SCAN = scanWith(
  [
    local('kiro', 'fetch', 'uvx', ['mcp-server-fetch']),
    local('kiro', 'mine', 'node', ['mine.js']),
    local('kiro', 'bad', './relative'),
  ],
  [local('pi', 'fetch', 'uvx', ['mcp-server-fetch']), local('pi', 'files', 'npx', ['-y', 'fs'])]
);

const APP: MCPServersMap = {
  s1: {
    id: 's1',
    name: 'Already here',
    enabled: false,
    transport: 'stdio',
    command: 'node',
    args: ['mine.js'],
    env: {},
  },
};

function Harness({
  initialServers = APP,
  initialDismissed = [],
  onDismissed,
  onServers,
}: {
  initialServers?: MCPServersMap;
  initialDismissed?: string[];
  onDismissed?: (keys: string[]) => void;
  onServers?: (servers: MCPServersMap) => void;
}) {
  const [servers, setServers] = useState(initialServers);
  const [dismissed, setDismissed] = useState(initialDismissed);
  return (
    <MCPServerSettings
      servers={servers}
      onChange={(next) => {
        setServers(next);
        onServers?.(next);
      }}
      importDismissed={dismissed}
      onImportDismissedChange={(keys) => {
        setDismissed(keys);
        onDismissed?.(keys);
      }}
    />
  );
}

const FILES_CONFIG: MCPServerConfig = {
  id: 'from-server',
  name: 'x',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'fs'],
  env: {},
};

beforeEach(() => {
  scanMCPImport.mockReset();
  readMCPImport.mockReset();
});

describe('MCP import', () => {
  it('shows the line with the count of importable servers and their tools', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    render(<Harness />);
    expect(await screen.findByText('2 servers in Kiro and Pi are not in this app')).toBeVisible();
    expect(scanMCPImport).toHaveBeenCalledTimes(1);
  });

  it('shows the line in the box of the empty tab', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    render(<Harness initialServers={{}} />);
    const line = await screen.findByText('3 servers in Kiro and Pi are not in this app');
    expect(line.closest('.border-dashed')).not.toBeNull();
  });

  it('shows nothing extra while the scan runs or when it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scanMCPImport.mockRejectedValue(new Error('down'));
    render(<Harness />);
    await waitFor(() => expect(scanMCPImport).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    warn.mockRestore();
  });

  it('Not now hides the line and stores the keys; a new server shows it again', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    const onDismissed = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Harness onDismissed={onDismissed} />);
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/are not in this app/)).toBeNull();
    const keys = onDismissed.mock.calls[0][0] as string[];
    expect(keys).toHaveLength(2);
    // Short hashes only: no command, argument, or URL text in the preferences
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{16}$/);
    unmount();

    // Same files: the line stays hidden
    render(<Harness initialDismissed={keys} />);
    await waitFor(() => expect(scanMCPImport).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/are not in this app/)).toBeNull();

    // A new server in the files shows the line again
    scanMCPImport.mockResolvedValue(
      scanWith(
        [...BASE_SCAN.files[0].servers, local('kiro', 'new', 'node', ['new.js'])],
        BASE_SCAN.files[1].servers
      )
    );
    render(<Harness initialDismissed={keys} />);
    expect(await screen.findByText('3 servers in Kiro and Pi are not in this app')).toBeVisible();
  });

  it('lists rows by tool, with no checkbox for added or blocked rows', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));

    const kiro = screen.getByRole('group', { name: 'Kiro' });
    expect(within(kiro).getByRole('checkbox', { name: /fetch/ })).not.toBeChecked();
    expect(within(kiro).getByText('Found in Kiro and Pi')).toBeVisible();
    expect(within(kiro).getByText('Already added')).toBeVisible();
    expect(within(kiro).getByText(/Cannot run: Use a program name/)).toBeVisible();
    expect(within(kiro).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(screen.getByRole('group', { name: 'Pi' })).getAllByRole('checkbox')).toHaveLength(
      1
    );
    expect(screen.getByText(/: too large/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import 0 servers' })).toBeDisabled();
  });

  it('Select all and Import add the selected servers, off', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    const found: Record<string, [string, string[]]> = {
      'kiro:rev:fetch': ['uvx', ['mcp-server-fetch']],
      'pi:rev:files': ['npx', ['-y', 'fs']],
    };
    readMCPImport.mockImplementation(async (keys) => ({
      servers: keys.map((key) => ({
        key,
        config: {
          id: 'from-server',
          name: 'x',
          enabled: true,
          transport: 'stdio',
          command: found[key][0],
          args: found[key][1],
          env: { TOKEN: 'value' },
        } satisfies MCPServerConfig,
      })),
      skipped: [],
    }));
    const onServers = vi.fn();
    const user = userEvent.setup();
    render(<Harness onServers={onServers} />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(
      true
    );
    await user.click(screen.getByRole('button', { name: 'Import 2 servers' }));

    expect(readMCPImport).toHaveBeenCalledWith(
      ['kiro:rev:fetch', 'pi:rev:files'],
      expect.any(AbortSignal)
    );
    const saved = onServers.mock.calls.at(-1)?.[0] as MCPServersMap;
    const added = Object.values(saved).filter((s) => s.id !== 's1');
    expect(added.map((s) => [s.name, s.enabled])).toEqual([
      ['fetch', false],
      ['files', false],
    ]);
    expect(new Set(added.map((s) => s.id)).size).toBe(2);
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 servers');
    // Now in the app: no line any more
    expect(screen.queryByText(/are not in this app/)).toBeNull();
  });

  it('imports one selected server and says why a server was skipped', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    readMCPImport.mockResolvedValue({
      servers: [],
      skipped: [{ key: 'pi:rev:files', reason: 'This server changed in the file.' }],
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('checkbox', { name: /files/ }));
    await user.click(screen.getByRole('button', { name: 'Import 1 server' }));
    expect(readMCPImport).toHaveBeenCalledWith(['pi:rev:files'], expect.any(AbortSignal));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'files was not imported. This server changed in the file.'
    );
  });

  it('Cancel is off while the read runs', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    let finish: (value: unknown) => void = () => {};
    readMCPImport.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('checkbox', { name: /files/ }));
    await user.click(screen.getByRole('button', { name: 'Import 1 server' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish({ servers: [], skipped: [] });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull());
  });

  it('adds nothing when the panel unmounts while the read runs, and stops the read', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    let finish: (value: unknown) => void = () => {};
    let signal: AbortSignal | undefined;
    readMCPImport.mockImplementation((_keys, s) => {
      signal = s;
      return new Promise((resolve) => (finish = resolve));
    });
    const onServers = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Harness onServers={onServers} />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('checkbox', { name: /files/ }));
    await user.click(screen.getByRole('button', { name: 'Import 1 server' }));
    unmount();
    expect(signal?.aborted).toBe(true);
    finish({ servers: [{ key: 'pi:rev:files', config: FILES_CONFIG }], skipped: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onServers).not.toHaveBeenCalled();
  });

  it('merges the import into the servers as they are when the read ends', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    let finish: (value: unknown) => void = () => {};
    readMCPImport.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const onServers = vi.fn();
    const user = userEvent.setup();
    render(<Harness onServers={onServers} />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('checkbox', { name: /files/ }));
    await user.click(screen.getByRole('button', { name: 'Import 1 server' }));
    // A server added in the tab while the read runs
    await user.click(screen.getByRole('button', { name: 'Local' }));
    finish({ servers: [{ key: 'pi:rev:files', config: FILES_CONFIG }], skipped: [] });
    await waitFor(() => expect(onServers).toHaveBeenCalledTimes(2));
    expect(Object.keys(onServers.mock.calls[1][0])).toHaveLength(3);
  });

  it('shows the command in its ~/ form', async () => {
    scanMCPImport.mockResolvedValue(
      scanWith([{ ...local('kiro', 'home', '/home/user/bin/server'), commandKey: '~/bin/server' }])
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    expect(screen.getByText('~/bin/server')).toBeVisible();
    expect(screen.queryByText(/\/home\/user/)).toBeNull();
  });

  it('Cancel closes the list', async () => {
    scanMCPImport.mockResolvedValue(BASE_SCAN);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('2 servers in Kiro and Pi are not in this app')).toBeVisible();
  });
});
