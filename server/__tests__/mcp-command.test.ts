// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative as relativePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCommand } from '../mcp-command';

/** The home folder that `os.homedir()` returns in these tests */
let fakeHome = '/home/user';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

let root: string;

/**
 * True when the temp folder is on a case-insensitive file system (APFS on macOS by default),
 * where `MY-PROG` finds `my-prog`. Probed once at run time.
 */
const caseInsensitive = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-command-test-case-'));
  try {
    writeFileSync(join(dir, 'x'), '');
    return existsSync(join(dir, 'X'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/** An executable script at `dir/name` */
function program(dir: string, name: string, mode = 0o755): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, mode);
  return file;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mcp-command-test-'));
  fakeHome = join(root, 'home');
  mkdirSync(fakeHome);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveCommand with a program name', () => {
  it('finds the name on PATH and returns its absolute path', async () => {
    const file = program(join(root, 'bin'), 'my-prog');
    await expect(resolveCommand('my-prog', { PATH: join(root, 'bin') })).resolves.toBe(file);
  });

  it('skips a folder and a file that is not executable, and takes a later match', async () => {
    mkdirSync(join(root, 'a', 'my-prog'), { recursive: true });
    program(join(root, 'b'), 'my-prog', 0o644);
    const file = program(join(root, 'c'), 'my-prog');
    const PATH = [join(root, 'a'), join(root, 'b'), join(root, 'c')].join(':');
    await expect(resolveCommand('my-prog', { PATH })).resolves.toBe(file);
  });

  it('uses the PATH that it gets (the child env), so the user PATH wins', async () => {
    program(join(root, 'first'), 'my-prog');
    const second = program(join(root, 'second'), 'my-prog');
    await expect(resolveCommand('my-prog', { PATH: join(root, 'second') })).resolves.toBe(second);
  });

  it('follows a link for the check and returns the link path (no realpath)', async () => {
    const target = program(join(root, 'real'), 'target');
    mkdirSync(join(root, 'bin'));
    symlinkSync(target, join(root, 'bin', 'my-prog'));
    await expect(resolveCommand('my-prog', { PATH: join(root, 'bin') })).resolves.toBe(
      join(root, 'bin', 'my-prog')
    );
  });

  it('says "Command not found" for no match, an empty PATH, and no PATH', async () => {
    mkdirSync(join(root, 'empty'));
    await expect(resolveCommand('my-prog', { PATH: join(root, 'empty') })).rejects.toThrow(
      /^Command not found: my-prog$/
    );
    await expect(resolveCommand('my-prog', { PATH: '' })).rejects.toThrow(
      'Command not found: my-prog'
    );
    await expect(resolveCommand('my-prog', {})).rejects.toThrow('Command not found: my-prog');
    const notText = { PATH: 42 } as unknown as Record<string, string>;
    await expect(resolveCommand('my-prog', notText)).rejects.toThrow('Command not found: my-prog');
  });

  it('says "Command not found" when the only match is a folder or not executable', async () => {
    mkdirSync(join(root, 'a', 'my-prog'), { recursive: true });
    program(join(root, 'b'), 'my-prog', 0o644);
    const PATH = [join(root, 'a'), join(root, 'b')].join(':');
    await expect(resolveCommand('my-prog', { PATH })).rejects.toThrow('Command not found: my-prog');
  });

  it('skips a relative and an empty PATH entry', async () => {
    // A relative entry that points at a real folder with the program, from where the tests run
    program(join(root, 'rel'), 'my-prog');
    const relative = relativePath(process.cwd(), join(root, 'rel'));
    expect(relative.startsWith('/')).toBe(false);
    await expect(resolveCommand('my-prog', { PATH: `${relative}::.` })).rejects.toThrow(
      'Command not found: my-prog'
    );
  });

  it('trims the command once', async () => {
    const file = program(join(root, 'bin'), 'my-prog');
    await expect(resolveCommand('  my-prog ', { PATH: join(root, 'bin') })).resolves.toBe(file);
  });

  it('keeps the case of the command in the error text', async () => {
    await expect(resolveCommand(' MY-PROG ', { PATH: join(root, 'bin') })).rejects.toThrow(
      /^Command not found: MY-PROG$/
    );
  });

  it.skipIf(caseInsensitive)('is case-sensitive on a case-sensitive file system', async () => {
    program(join(root, 'bin'), 'my-prog');
    await expect(resolveCommand(' MY-PROG ', { PATH: join(root, 'bin') })).rejects.toThrow(
      /^Command not found: MY-PROG$/
    );
  });
});

describe('resolveCommand with a path', () => {
  it('takes a full path to a program', async () => {
    const file = program(join(root, 'opt'), 'server');
    await expect(resolveCommand(file, { PATH: '' })).resolves.toBe(file);
  });

  it('expands ~/ with os.homedir(), not with HOME from the env', async () => {
    const file = program(join(fakeHome, 'bin'), 'server');
    const otherHome = join(root, 'other');
    program(join(otherHome, 'bin'), 'server');
    await expect(resolveCommand('~/bin/server', { HOME: otherHome })).resolves.toBe(file);
  });

  it('says "is not a program" for a missing file, a folder, and a file that is not executable', async () => {
    const missing = join(root, 'nope');
    mkdirSync(join(root, 'folder'));
    const plain = program(join(root, 'opt'), 'plain', 0o644);
    await expect(resolveCommand(missing, {})).rejects.toThrow(`${missing} is not a program`);
    await expect(resolveCommand(join(root, 'folder'), {})).rejects.toThrow(
      `${join(root, 'folder')} is not a program`
    );
    await expect(resolveCommand(plain, {})).rejects.toThrow(`${plain} is not a program`);
  });

  it('names a ~/ path as typed, not the home folder', async () => {
    await expect(resolveCommand('~/missing', {})).rejects.toThrow(/^~\/missing is not a program$/);
  });

  it('refuses a relative path', async () => {
    program(join(root, 'bin'), 'server');
    await expect(resolveCommand('./server', { PATH: join(root, 'bin') })).rejects.toThrow(
      'Use a program name or a full path that starts with / or ~/'
    );
    await expect(resolveCommand('bin/server', { PATH: root })).rejects.toThrow(
      'Use a program name or a full path that starts with / or ~/'
    );
  });
});
