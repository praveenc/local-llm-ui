import { describe, expect, it } from 'vitest';

import type { MCPServersMap } from '../../types/mcp';
import { sanitizeServerName } from '../mcpCommand';
import {
  MASK,
  PLACEHOLDER_COMMAND_ERROR,
  URL_NOT_VALID,
  buildImportRows,
  cannotRunReason,
  foundInText,
  hasNewImports,
  homeForm,
  homeFormArgs,
  homePrefix,
  importLineText,
  maskArguments,
  placeholderNote,
  sameServerKey,
  shortHash,
  toServerConfig,
} from '../mcpImport';
import type { MCPImportScan, ScannedFile, ScannedServer } from '../mcpImport';

const stdio = (name: string, command: string, args: string[] = [], extra = {}): ScannedServer => ({
  key: `k:${name}`,
  name,
  transport: 'stdio',
  command,
  args,
  envNames: [],
  placeholders: 0,
  ...extra,
});

const file = (tool: ScannedFile['tool'], servers: ScannedServer[]): ScannedFile => ({
  tool,
  label: tool,
  file: `~/${tool}.json`,
  status: 'ok',
  servers: servers.map((s) => ({ ...s, key: `${tool}:r:${s.name}` })),
});

const scanOf = (...files: ScannedFile[]): MCPImportScan => ({ files });

describe('sameServerKey', () => {
  it('matches the same command and arguments in order', () => {
    expect(sameServerKey(stdio('a', 'uvx', ['x', 'y']))).toBe(
      sameServerKey({ transport: 'stdio', command: ' uvx ', args: ['x', 'y'] })
    );
    expect(sameServerKey(stdio('a', 'uvx', ['x', 'y']))).not.toBe(
      sameServerKey(stdio('a', 'uvx', ['y', 'x']))
    );
    expect(sameServerKey(stdio('a', 'npx', ['pkg']))).not.toBe(
      sameServerKey(stdio('a', 'npx', ['pkg@latest']))
    );
  });

  it('uses the ~/ form of the command that the server sends', () => {
    expect(sameServerKey(stdio('a', '/home/user/bin/x', [], { commandKey: '~/bin/x' }))).toBe(
      sameServerKey({ transport: 'stdio', command: '~/bin/x', args: [] })
    );
  });

  it('compares a full server with its masked scan', () => {
    expect(sameServerKey({ transport: 'stdio', command: 'x', args: ['--token', 'abc'] })).toBe(
      sameServerKey(stdio('a', 'x', ['--token', MASK]))
    );
  });

  it('matches remote servers by transport and URL without query', () => {
    expect(sameServerKey({ transport: 'http', url: 'https://a.example/mcp?key=1' })).toBe(
      sameServerKey({ transport: 'http', url: 'https://A.example/mcp' })
    );
    expect(sameServerKey({ transport: 'http', url: 'https://a.example/mcp' })).not.toBe(
      sameServerKey({ transport: 'sse', url: 'https://a.example/mcp' })
    );
  });
});

describe('maskArguments', () => {
  it('masks values after secret flags and the query of URLs', () => {
    expect(
      maskArguments([
        '--api-key',
        's',
        '--TOKEN=s',
        '--password',
        's',
        '-v',
        'https://u:p@x.example/a?b=1',
      ])
    ).toEqual([
      '--api-key',
      MASK,
      `--TOKEN=${MASK}`,
      '--password',
      MASK,
      '-v',
      'https://x.example/a',
    ]);
  });

  it('cuts user info that holds a raw /, ?, or # up to the last @', () => {
    expect(
      maskArguments([
        'https://u:S/x@h.example/p',
        'https://u:S?x@h.example/p',
        'https://u:S#x@h.example/p',
        '--url=wss://u:S/x?y#z@h.example/p?token=S',
      ])
    ).toEqual([
      'https://h.example/p',
      'https://h.example/p',
      'https://h.example/p',
      '--url=wss://h.example/p',
    ]);
    // Masking again changes nothing
    const once = maskArguments(['https://u:S?x@h.example/p']);
    expect(maskArguments(once)).toEqual(once);
  });

  it('cuts the query, fragment, and user info of any scheme:// URL, also after --flag=', () => {
    expect(
      maskArguments([
        '--url=https://h.example/sse?api_key=s',
        'wss://h.example/x?token=s',
        'ws://u:p@h.example/x#s',
        'custom+x://u@h.example/p?q=s',
        '--to=ftp://u:p@h.example/f',
        'not-a-url?x=1',
      ])
    ).toEqual([
      '--url=https://h.example/sse',
      'wss://h.example/x',
      'ws://h.example/x',
      'custom+x://h.example/p',
      '--to=ftp://h.example/f',
      'not-a-url?x=1',
    ]);
  });

  it('masks -e and --env values and keeps the name', () => {
    expect(
      maskArguments(['run', '-e', 'GITHUB_TOKEN=s', '-e', 'FROM_HOST', '--env', 'A=s', '--env=B=s'])
    ).toEqual([
      'run',
      '-e',
      `GITHUB_TOKEN=${MASK}`,
      '-e',
      'FROM_HOST',
      '--env',
      `A=${MASK}`,
      `--env=B=${MASK}`,
    ]);
  });

  it('masks header values and keeps the header name', () => {
    expect(
      maskArguments([
        '--header',
        'Authorization: Bearer s',
        '--header=X-Key: s',
        '-H',
        'Cookie:s',
        '--header',
        'novalue',
      ])
    ).toEqual([
      '--header',
      `Authorization: ${MASK}`,
      `--header=X-Key: ${MASK}`,
      '-H',
      `Cookie: ${MASK}`,
      '--header',
      MASK,
    ]);
  });

  it('masks the value after a short flag whose name holds key, token, secret, or password', () => {
    expect(maskArguments(['-token', 's', '-apiKey', 's', '-secret=s', '-pw', 'x'])).toEqual([
      '-token',
      MASK,
      '-apiKey',
      MASK,
      `-secret=${MASK}`,
      '-pw',
      'x',
    ]);
  });

  it('changes nothing in a masked list', () => {
    const once = maskArguments([
      '--secret',
      's',
      'plain',
      '-e',
      'A=s',
      '--header',
      'H: s',
      '--url=https://u:p@h.example?q=1',
    ]);
    expect(maskArguments(once)).toEqual(once);
  });
});

describe('buildImportRows', () => {
  it('groups the same server across tools, first tool wins', () => {
    const rows = buildImportRows(
      scanOf(
        file('kiro', [stdio('fetch', 'uvx', ['mcp-server-fetch'])]),
        file('pi', [stdio('fetch-pi', 'uvx', ['mcp-server-fetch']), stdio('other', 'node')])
      ),
      {}
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ tool: 'kiro', tools: ['kiro', 'pi'], key: 'kiro:r:fetch' });
    expect(foundInText(rows[0])).toBe('Found in Kiro and Pi');
    expect(foundInText(rows[1])).toBeNull();
  });

  it('marks a server that the app has as already added, also when it is off', () => {
    const app: MCPServersMap = {
      s1: {
        id: 's1',
        name: 'mine',
        enabled: false,
        transport: 'stdio',
        command: 'uvx',
        args: ['x'],
        env: {},
      },
    };
    const rows = buildImportRows(scanOf(file('kiro', [stdio('fetch', 'uvx', ['x'])])), app);
    expect(rows[0].state).toBe('added');
  });

  it('writes the app command in the home folder as ~/ before it compares', () => {
    const app: MCPServersMap = {
      s1: {
        id: 's1',
        name: 'mine',
        enabled: false,
        transport: 'stdio',
        command: '/home/user/bin/x',
        args: [],
        env: {},
      },
    };
    const scan = {
      ...scanOf(file('kiro', [stdio('x', '~/bin/x', [], { commandKey: '~/bin/x' })])),
      homeHash: shortHash('/home/user/'),
    };
    expect(buildImportRows(scan, app)[0].state).toBe('added');
    // Another home folder does not match
    expect(buildImportRows({ ...scan, homeHash: shortHash('/home/other/') }, app)[0].state).toBe(
      'importable'
    );
  });

  it('writes app path arguments in the home folder as ~/ before it compares', () => {
    const app: MCPServersMap = {
      s1: {
        id: 's1',
        name: 'files',
        enabled: false,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/notes'],
        env: {},
      },
    };
    const scanned = stdio('fs', 'npx', [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '~/notes',
    ]);
    const scan = { ...scanOf(file('kiro', [scanned])), homeHash: shortHash('/home/user/') };
    expect(buildImportRows(scan, app)[0].state).toBe('added');
    expect(buildImportRows({ ...scan, homeHash: shortHash('/home/other/') }, app)[0].state).toBe(
      'importable'
    );
  });

  it('gives entries with no command or no URL a row each', () => {
    const broken = (name: string): ScannedServer => ({
      key: `k:${name}`,
      name,
      transport: 'stdio',
      placeholders: 0,
      blocked: 'The app cannot read this entry',
    });
    const remote = (name: string): ScannedServer => ({
      key: `k:${name}`,
      name,
      transport: 'http',
      url: '',
      placeholders: 0,
      blocked: 'The URL is not valid',
    });
    const rows = buildImportRows(
      scanOf(
        file('kiro', [broken('one'), broken('two'), remote('r1'), remote('r2')]),
        file('pi', [broken('one')])
      ),
      {}
    );
    expect(rows.map((r) => [r.tool, r.server.name])).toEqual([
      ['kiro', 'one'],
      ['kiro', 'two'],
      ['kiro', 'r1'],
      ['kiro', 'r2'],
      ['pi', 'one'],
    ]);
    expect(rows.every((r) => foundInText(r) === null)).toBe(true);
  });

  it('renames on a clash of sanitized names', () => {
    const app: MCPServersMap = {
      s1: {
        id: 's1',
        name: 'my-server',
        enabled: true,
        transport: 'stdio',
        command: 'a',
        args: [],
        env: {},
      },
    };
    const rows = buildImportRows(
      scanOf(
        file('kiro', [stdio('my_server', 'b')]),
        file('pi', [stdio('My Server', 'c'), stdio('fresh', 'd')])
      ),
      app
    );
    expect(sanitizeServerName('my-server')).toBe(sanitizeServerName('my_server'));
    expect(rows.map((r) => r.importName)).toEqual(['my_server (Kiro)', 'My Server (Pi)', 'fresh']);
  });

  it('gives each blocked row its reason and no import', () => {
    const rows = buildImportRows(
      scanOf(
        file('kiro', [
          stdio('rel', './x'),
          stdio('shell', 'node', ['a|b']),
          stdio('ph', '${HOME}/x'),
          stdio('server', 'node', [], { blocked: 'Localhost URLs are not allowed' }),
        ])
      ),
      {}
    );
    expect(rows.map((r) => [r.state, r.reason])).toEqual([
      ['blocked', 'Use a program name or a full path that starts with / or ~/'],
      ['blocked', 'Argument 1 contains characters that the app does not allow'],
      ['blocked', PLACEHOLDER_COMMAND_ERROR],
      ['blocked', 'Localhost URLs are not allowed'],
    ]);
  });

  it('counts and names the tools of importable rows only', () => {
    const rows = buildImportRows(
      scanOf(
        file('kiro', [stdio('a', 'x'), stdio('b', './bad')]),
        file('pi', [stdio('c', 'y')]),
        file('cursor', [stdio('d', './bad2')])
      ),
      {}
    );
    expect(importLineText(rows)).toBe('2 servers in Kiro and Pi are not in this app');
    expect(importLineText(rows.slice(0, 1))).toBe('1 server in Kiro is not in this app');
  });

  it('leaves out files that the scan could not read', () => {
    const bad = { ...file('kiro', [stdio('a', 'x')]), status: 'too-large' as const };
    expect(buildImportRows(scanOf(bad), {})).toEqual([]);
  });

  it('shows the line again only for a key that Not now did not store', () => {
    const rows = buildImportRows(scanOf(file('kiro', [stdio('a', 'x', ['--path', '/srv/a'])])), {});
    const keys = rows.map((r) => r.dismissKey);
    // A short hash, never the text of the key
    expect(keys[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(keys[0]).toBe(shortHash(rows[0].sameKey));
    expect(
      hasNewImports(
        rows,
        rows.map((r) => r.sameKey)
      )
    ).toBe(true);
    expect(hasNewImports(rows, [])).toBe(true);
    expect(hasNewImports(rows, keys)).toBe(false);
    const more = buildImportRows(
      scanOf(file('kiro', [stdio('a', 'x', ['--path', '/srv/a']), stdio('b', 'y')])),
      {}
    );
    expect(hasNewImports(more, keys)).toBe(true);
  });

  it('counts and names only the rows that Not now did not hide', () => {
    const rows = buildImportRows(
      scanOf(file('kiro', [stdio('a', 'x')]), file('pi', [stdio('b', 'y'), stdio('c', 'z')])),
      {}
    );
    const kiroKey = rows.filter((r) => r.tools.includes('kiro')).map((r) => r.dismissKey);
    const piKeys = rows.filter((r) => !r.tools.includes('kiro')).map((r) => r.dismissKey);
    expect(importLineText(rows, kiroKey)).toBe('2 servers in Pi are not in this app');
    expect(importLineText(rows, [...piKeys, 'stale-key'])).toBe(
      '1 server in Kiro is not in this app'
    );
  });
});

describe('shortHash', () => {
  it('is 16 hex characters and stable', () => {
    expect(shortHash('')).toBe('cbf29ce484222325');
    expect(shortHash('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
  });
});

describe('cannotRunReason', () => {
  it('takes a good local and a good remote server', () => {
    expect(cannotRunReason({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] })).toBeNull();
    expect(cannotRunReason({ transport: 'http', url: 'https://x.example/mcp' })).toBeNull();
  });

  it('refuses $VAR in an argument and a URL that does not parse', () => {
    expect(cannotRunReason({ transport: 'stdio', command: 'node', args: ['$HOME'] })).toBe(
      PLACEHOLDER_COMMAND_ERROR
    );
    expect(cannotRunReason({ transport: 'sse', url: 'nope' })).toBe(URL_NOT_VALID);
    expect(cannotRunReason({ transport: 'http', url: 'ftp://x.example' })).toMatch(/http/);
  });
});

describe('placeholderNote', () => {
  it('says how many values use ${…}', () => {
    expect(placeholderNote(0)).toBeNull();
    expect(placeholderNote(1)).toBe(
      '1 value uses ${…}. The app passes it as text. Type the real value after the import.'
    );
    expect(placeholderNote(3)).toBe(
      '3 values use ${…}. The app passes them as text. Type the real values after the import.'
    );
  });
});

describe('toServerConfig', () => {
  it('makes an off server in the app shape', () => {
    expect(
      toServerConfig(
        { name: 'a', transport: 'sse', url: ' https://x.example/sse ', headers: { H: 'v' } },
        'id1'
      )
    ).toEqual({
      id: 'id1',
      name: 'a',
      enabled: false,
      transport: 'sse',
      url: 'https://x.example/sse',
      headers: { H: 'v' },
    });
  });
});

describe('homeForm', () => {
  it('writes a path in the home folder as ~/', () => {
    expect(homeForm('/home/user/bin/x', '/home/user')).toBe('~/bin/x');
    expect(homeForm('/home/user/bin/x', '/home/user/')).toBe('~/bin/x');
    expect(homeForm('/home/username/x', '/home/user')).toBe('/home/username/x');
  });

  it('has no ~/ form when the home folder is /', () => {
    expect(homePrefix('/')).toBeNull();
    expect(homePrefix('')).toBeNull();
    expect(homeForm('/usr/bin/node', '/')).toBe('/usr/bin/node');
    expect(homeForm('/bin/x', '')).toBe('/bin/x');
  });

  it('writes path arguments and --flag= values, and leaves other arguments', () => {
    const form = (p: string) => homeForm(p, '/home/user');
    expect(
      homeFormArgs(['/home/user/notes', '--root=/home/user/r', '-v', 'x=/home/user/y', '~/z'], form)
    ).toEqual(['~/notes', '--root=~/r', '-v', 'x=/home/user/y', '~/z']);
  });
});
