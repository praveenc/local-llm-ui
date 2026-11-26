// @vitest-environment node
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'fs/promises';
import { createServer, request } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIRO_FOLDER_MESSAGES } from '../../src/utils/kiroSettings.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import type { KiroProxyOptions } from '../kiro-proxy.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';
import {
  KIRO_FOLDER_UNAVAILABLE,
  KiroFolderError,
  KiroPrivateDirError,
  createKiroSettings,
  ensurePrivateDir,
  getKiroSettings,
  kiroSettingsFor,
} from '../kiro/settings.ts';
import { createApiGuard } from '../security.ts';

const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/.local/bin/kiro-cli',
  version: '3.6.2',
  account: { type: 'builder-id', email: 'you@example.com' },
};

const isRoot = process.getuid?.() === 0;

let root: string;
let counter = 0;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kiro-settings-test-')));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function freshHome() {
  counter += 1;
  const home = path.join(root, `case-${counter}`, 'home');
  await mkdir(home, { recursive: true });
  const work = path.join(home, 'work');
  await mkdir(work);
  const file = path.join(home, '.local-llm-ui', 'kiro-settings.json');
  const readStored = async () => JSON.parse(await readFile(file, 'utf8')) as unknown;
  return { home, work, file, readStored };
}

describe('createKiroSettings', () => {
  it('stores the real path of ~/work in a 0600 file in a 0700 folder', async () => {
    const h = await freshHome();
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.folder()).toEqual({ path: '~/.local-llm-ui/kiro', isDefault: true });
    expect(await settings.workspaceDir()).toBeUndefined();

    const result = await settings.set('~/work');
    expect(result).toEqual({ ok: true, folder: { path: '~/work', isDefault: false } });
    expect(await h.readStored()).toEqual({ workspaceDir: h.work });
    expect((await stat(h.file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(h.file))).mode & 0o777).toBe(0o700);
    expect(await settings.workspaceDir()).toBe(h.work);
    // A new reader of the same home reads the file
    const again = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await again.workspaceDir()).toBe(h.work);
  });

  it('stores the real path, not a symlink', async () => {
    const h = await freshHome();
    await symlink(h.work, path.join(h.home, 'link'));
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set(path.join(h.home, 'link'))).toMatchObject({ ok: true });
    expect(await h.readStored()).toEqual({ workspaceDir: h.work });
  });

  it('accepts an absolute path outside the home folder', async () => {
    const h = await freshHome();
    const outside = path.join(root, `outside-${counter}`);
    await mkdir(outside);
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set(outside)).toEqual({
      ok: true,
      folder: { path: outside, isDefault: false },
    });
  });

  it('goes back to the default with null, and stores the default folder as null', async () => {
    const h = await freshHome();
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    await settings.set('~/work');
    expect(await settings.set(null)).toEqual({
      ok: true,
      folder: { path: '~/.local-llm-ui/kiro', isDefault: true },
    });
    expect(await h.readStored()).toEqual({ workspaceDir: null });
    expect(await settings.workspaceDir()).toBeUndefined();

    await mkdir(path.join(h.home, '.local-llm-ui', 'kiro'), { recursive: true });
    expect(await settings.set('~/.local-llm-ui/kiro')).toMatchObject({
      ok: true,
      folder: { isDefault: true },
    });
    expect(await h.readStored()).toEqual({ workspaceDir: null });
  });

  it('never creates a folder', async () => {
    const h = await freshHome();
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set('~/missing')).toEqual({
      ok: false,
      error: KIRO_FOLDER_MESSAGES.notFound,
    });
    await expect(stat(path.join(h.home, 'missing'))).rejects.toThrow();
    // A refused value writes no file
    await expect(stat(h.file)).rejects.toThrow();
  });

  it.each([
    [
      'a file',
      async (home: string) => (await writeFile(path.join(home, 'f.txt'), 'x'), '~/f.txt'),
      KIRO_FOLDER_MESSAGES.notFolder,
    ],
    [
      'a path through a file',
      async (home: string) => (await writeFile(path.join(home, 'g'), 'x'), '~/g/sub'),
      KIRO_FOLDER_MESSAGES.notFolder,
    ],
    ['/', async () => '/', KIRO_FOLDER_MESSAGES.system],
    ['the home folder', async (home: string) => home, KIRO_FOLDER_MESSAGES.home],
    ['~', async () => '~', KIRO_FOLDER_MESSAGES.home],
    ['/etc', async () => '/etc', KIRO_FOLDER_MESSAGES.system],
    ['/usr/lib', async () => '/usr/lib', KIRO_FOLDER_MESSAGES.system],
    [
      'a symlink to /etc',
      async (home: string) => (await symlink('/etc', path.join(home, 'etc-link')), '~/etc-link'),
      KIRO_FOLDER_MESSAGES.system,
    ],
    [
      '~/.ssh',
      async (home: string) => (await mkdir(path.join(home, '.ssh')), '~/.ssh'),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'a folder in ~/.aws',
      async (home: string) => (
        await mkdir(path.join(home, '.aws', 'x'), { recursive: true }),
        '~/.aws/x'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      '~/.local-llm-ui/other',
      async (home: string) => (
        await mkdir(path.join(home, '.local-llm-ui', 'other'), { recursive: true }),
        '~/.local-llm-ui/other'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'a symlinked ~/.ssh typed as ~/.ssh',
      async (home: string) => (
        await mkdir(path.join(home, 'dotfiles', 'ssh'), { recursive: true }),
        await symlink(path.join(home, 'dotfiles', 'ssh'), path.join(home, '.ssh')),
        '~/.ssh'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'the target of a symlinked ~/.ssh',
      async (home: string) => (
        await mkdir(path.join(home, 'dotfiles', 'ssh'), { recursive: true }),
        await symlink(path.join(home, 'dotfiles', 'ssh'), path.join(home, '.ssh')),
        '~/dotfiles/ssh'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'a folder that holds the target of a symlinked ~/.ssh',
      async (home: string) => (
        await mkdir(path.join(home, 'dotfiles', 'ssh'), { recursive: true }),
        await symlink(path.join(home, 'dotfiles', 'ssh'), path.join(home, '.ssh')),
        '~/dotfiles'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'a folder that holds the target of a symlinked ~/.local-llm-ui',
      async (home: string) => (
        await mkdir(path.join(home, 'dotfiles', 'llmui'), { recursive: true }),
        await symlink(path.join(home, 'dotfiles', 'llmui'), path.join(home, '.local-llm-ui')),
        '~/dotfiles'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'the default folder as a symlink to a folder that holds the real ~/.ssh, typed as the default',
      async (home: string) => (
        await mkdir(path.join(home, 'dot', 'ssh'), { recursive: true }),
        await symlink(path.join(home, 'dot', 'ssh'), path.join(home, '.ssh')),
        await mkdir(path.join(home, '.local-llm-ui'), { recursive: true }),
        await symlink(path.join(home, 'dot'), path.join(home, '.local-llm-ui', 'kiro')),
        '~/.local-llm-ui/kiro'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    [
      'the real folder behind a default folder that holds the real ~/.ssh',
      async (home: string) => (
        await mkdir(path.join(home, 'dot', 'ssh'), { recursive: true }),
        await symlink(path.join(home, 'dot', 'ssh'), path.join(home, '.ssh')),
        await mkdir(path.join(home, '.local-llm-ui'), { recursive: true }),
        await symlink(path.join(home, 'dot'), path.join(home, '.local-llm-ui', 'kiro')),
        '~/dot'
      ),
      KIRO_FOLDER_MESSAGES.settings,
    ],
    ['control characters', async () => '~/wo\u0007rk', KIRO_FOLDER_MESSAGES.badCharacters],
    ['a bidi character', async () => '~/wo\u202erk', KIRO_FOLDER_MESSAGES.badCharacters],
    ['a relative path', async () => 'work', KIRO_FOLDER_MESSAGES.notAbsolute],
    ['an empty text', async () => '  ', KIRO_FOLDER_MESSAGES.empty],
    ['1,025 characters', async () => `/${'a'.repeat(1024)}`, KIRO_FOLDER_MESSAGES.tooLong],
  ])('refuses %s', async (_name, make, message) => {
    const h = await freshHome();
    const text = await make(h.home);
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set(text)).toEqual({ ok: false, error: message });
    await expect(stat(h.file)).rejects.toThrow();
  });

  it('refuses a folder of another owner', async () => {
    const h = await freshHome();
    const uid = (process.getuid?.() ?? 1000) + 1;
    const settings = createKiroSettings({ home: h.home, platform: 'linux', uid });
    expect(await settings.set('~/work')).toEqual({
      ok: false,
      error: KIRO_FOLDER_MESSAGES.notOwned,
    });
  });

  it.skipIf(isRoot)('refuses a folder that the user cannot write to', async () => {
    const h = await freshHome();
    await chmod(h.work, 0o500);
    try {
      const settings = createKiroSettings({ home: h.home, platform: 'linux' });
      expect(await settings.set('~/work')).toEqual({
        ok: false,
        error: KIRO_FOLDER_MESSAGES.notWritable,
      });
    } finally {
      await chmod(h.work, 0o700);
    }
  });

  it.each([
    ['corrupt', 'not json'],
    ['relative', JSON.stringify({ workspaceDir: 'work' })],
    ['oversized', JSON.stringify({ workspaceDir: null, pad: 'x'.repeat(5000) })],
  ])('uses the default folder for a %s settings file', async (_name, content) => {
    const h = await freshHome();
    await mkdir(path.dirname(h.file), { recursive: true });
    await writeFile(h.file, content, { mode: 0o600 });
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.workspaceDir()).toBeUndefined();
    expect(await settings.folder()).toEqual({ path: '~/.local-llm-ui/kiro', isDefault: true });
    // The log line names no path and no content
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).not.toContain(h.home);
    expect(logged).not.toContain(content.slice(0, 8));
  });

  it('throws the plain message when a stored folder is removed or becomes a symlink', async () => {
    const h = await freshHome();
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    await settings.set('~/work');
    await rm(h.work, { recursive: true });
    await expect(settings.workspaceDir()).rejects.toBeInstanceOf(KiroFolderError);
    await expect(settings.workspaceDir()).rejects.toThrow(KIRO_FOLDER_UNAVAILABLE);
    // A symlink in its place to a system folder is not followed
    await symlink('/etc', h.work);
    await expect(settings.workspaceDir()).rejects.toThrow(KIRO_FOLDER_UNAVAILABLE);
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).not.toContain(h.home);
  });

  it('runs writes one at a time: the last one wins', async () => {
    const h = await freshHome();
    await mkdir(path.join(h.home, 'other'));
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    await Promise.all([settings.set('~/work'), settings.set('~/other')]);
    expect(await h.readStored()).toEqual({ workspaceDir: path.join(h.home, 'other') });
    expect(await settings.workspaceDir()).toBe(path.join(h.home, 'other'));
  });
});

describe('the settings folder mode (D28)', () => {
  const mode = async (p: string) => (await stat(p)).mode & 0o777;
  const SAVE_FAILED = { ok: false, error: 'Could not save the folder. Try again.' };

  it('follows a symlinked ~/.local-llm-ui but keeps the mode of its target', async () => {
    const h = await freshHome();
    const target = path.join(h.home, 'dotfiles', 'lli');
    await mkdir(target, { recursive: true });
    await chmod(target, 0o755);
    await symlink(target, path.join(h.home, '.local-llm-ui'));
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set('~/work')).toMatchObject({ ok: true });
    expect(await mode(target)).toBe(0o755);
    expect((await lstat(path.join(h.home, '.local-llm-ui'))).isSymbolicLink()).toBe(true);
    const file = path.join(target, 'kiro-settings.json');
    expect(await mode(file)).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ workspaceDir: h.work });
  });

  it('sets 0700 on a real ~/.local-llm-ui with a loose mode', async () => {
    const h = await freshHome();
    const dir = path.join(h.home, '.local-llm-ui');
    await mkdir(dir);
    await chmod(dir, 0o755);
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set(null)).toMatchObject({ ok: true });
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(h.file)).toBe(0o600);
  });

  it('makes a new ~/.local-llm-ui with 0700', async () => {
    const h = await freshHome();
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set(null)).toMatchObject({ ok: true });
    expect(await mode(path.join(h.home, '.local-llm-ui'))).toBe(0o700);
    expect(await mode(h.file)).toBe(0o600);
  });

  it('refuses a link to a folder of another owner and leaves its mode', async () => {
    const h = await freshHome();
    const target = path.join(h.home, 'dotfiles', 'lli');
    await mkdir(target, { recursive: true });
    await chmod(target, 0o755);
    await symlink(target, path.join(h.home, '.local-llm-ui'));
    // Another uid: the target, owned by this user, counts as a folder of another owner
    const uid = (process.getuid?.() ?? 1000) + 1;
    const settings = createKiroSettings({ home: h.home, platform: 'linux', uid });
    expect(await settings.set(null)).toEqual(SAVE_FAILED);
    expect(await mode(target)).toBe(0o755);
    await expect(stat(path.join(target, 'kiro-settings.json'))).rejects.toThrow();
  });

  it('gives the plain error for a dangling ~/.local-llm-ui link', async () => {
    const h = await freshHome();
    await symlink(path.join(h.home, 'missing'), path.join(h.home, '.local-llm-ui'));
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    expect(await settings.set(null)).toEqual(SAVE_FAILED);
    await expect(stat(path.join(h.home, 'missing'))).rejects.toThrow();
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).not.toContain(h.home);
  });
});

describe('ensurePrivateDir', () => {
  it('throws an lstat error that is not ENOENT, and makes nothing', async () => {
    const h = await freshHome();
    const file = path.join(h.home, 'a-file');
    await writeFile(file, 'x');
    // ENOTDIR: a path under a file is not "missing"
    await expect(ensurePrivateDir(path.join(file, 'sub'), undefined)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
    expect((await lstat(file)).isFile()).toBe(true);
  });

  it('throws ELOOP for a link loop, and does not chmod the link target', async () => {
    const h = await freshHome();
    const one = path.join(h.home, 'loop-one');
    const two = path.join(h.home, 'loop-two');
    await symlink(two, one);
    await symlink(one, two);
    await expect(ensurePrivateDir(path.join(one, 'sub'), undefined)).rejects.toMatchObject({
      code: 'ELOOP',
    });
  });

  it('treats only ENOENT as a missing path: it makes the folder with 0700', async () => {
    const h = await freshHome();
    const dir = path.join(h.home, 'new', 'deep');
    await ensurePrivateDir(dir, undefined);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('throws the mkdir error for a path that is a file', async () => {
    const h = await freshHome();
    const file = path.join(h.home, 'a-file');
    await writeFile(file, 'x');
    await expect(ensurePrivateDir(file, undefined)).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('exports a typed error for a folder of another owner', () => {
    expect(new KiroPrivateDirError('not-owned').reason).toBe('not-owned');
    expect(new KiroPrivateDirError('not-folder').message).toBe('is not a folder');
  });

  it('gives the plain save error when ~/.local-llm-ui sits under a file', async () => {
    const h = await freshHome();
    const home = path.join(h.home, 'blocked');
    await writeFile(home, 'x');
    const settings = createKiroSettings({ home, platform: 'linux' });
    expect(await settings.set(null)).toEqual({
      ok: false,
      error: 'Could not save the folder. Try again.',
    });
  });
});

describe('kiroSettingsFor (S11)', () => {
  const environment = (home: string): KiroEnvironment => ({ env: {}, home, platform: 'linux' });

  it('gives the shared settings without an environment', () => {
    expect(kiroSettingsFor()).toBe(getKiroSettings());
  });

  it('gives one settings object per environment object', async () => {
    const h = await freshHome();
    const first = environment(h.home);
    expect(kiroSettingsFor(first)).toBe(kiroSettingsFor(first));
    expect(kiroSettingsFor(first)).not.toBe(kiroSettingsFor(environment(h.home)));
    expect(kiroSettingsFor(first)).not.toBe(getKiroSettings());
    // A save through one call is seen by the next call for the same environment
    await kiroSettingsFor(first).set('~/work');
    expect(await kiroSettingsFor(first).workspaceDir()).toBe(h.work);
  });
});

describe('POST /api/kiro/settings and GET /api/kiro/status', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const h = await freshHome();
    const settings = createKiroSettings({ home: h.home, platform: 'linux' });
    // An agent that fails every call: these routes must never start Kiro CLI
    const used = vi.fn(() => {
      throw new Error('the settings route must not use the agent');
    });
    const agent = new Proxy({}, { get: () => used }) as NonNullable<KiroProxyOptions['agent']>;
    const proxy = createKiroProxy({ reader: { read: async () => SIGNED_IN }, settings, agent });
    const guard = createApiGuard();
    const server: Server = createServer((req, res) => {
      guard(req, res, () => {
        void proxy(req, res, () => {
          res.statusCode = 404;
          res.end();
        });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cleanups.push(async () => {
      proxy.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const post = (body: string, contentType = 'application/json') =>
      fetch(`${base}/api/kiro/settings`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      });
    return { ...h, base, post, used };
  }

  it('saves a folder and shows it in the status', async () => {
    const c = await setup();
    const res = await c.post(JSON.stringify({ workspaceDir: '~/work' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ folder: { path: '~/work', isDefault: false } });

    const status = await fetch(`${c.base}/api/kiro/status`);
    expect(await status.json()).toEqual({
      ...SIGNED_IN,
      folder: { path: '~/work', isDefault: false },
    });

    const reset = await c.post(JSON.stringify({ workspaceDir: null }));
    expect(await reset.json()).toEqual({
      folder: { path: '~/.local-llm-ui/kiro', isDefault: true },
    });
    expect(await c.readStored()).toEqual({ workspaceDir: null });
    expect(c.used).not.toHaveBeenCalled();
  });

  it('answers 400 with the message for a refused folder and stores nothing', async () => {
    const c = await setup();
    for (const [body, error] of [
      [{ workspaceDir: '/etc' }, KIRO_FOLDER_MESSAGES.system],
      [{ workspaceDir: '~' }, KIRO_FOLDER_MESSAGES.home],
      [{ workspaceDir: '~/missing' }, KIRO_FOLDER_MESSAGES.notFound],
      [{ workspaceDir: 42 }, KIRO_FOLDER_MESSAGES.notText],
      [{}, KIRO_FOLDER_MESSAGES.notText],
    ] as const) {
      const res = await c.post(JSON.stringify(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    const bad = await c.post('{not json');
    expect(bad.status).toBe(400);
    await expect(stat(c.file)).rejects.toThrow();
    expect(c.used).not.toHaveBeenCalled();
  });

  it('refuses a GET, a body above 4 KB, and a body that is not JSON', async () => {
    const c = await setup();
    const get = await fetch(`${c.base}/api/kiro/settings`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const big = await c.post(JSON.stringify({ workspaceDir: `~/${'a'.repeat(5000)}` }));
    expect(big.status).toBe(413);
    const text = await c.post('workspaceDir=/tmp', 'text/plain');
    expect(text.status).toBe(415);
    await expect(stat(c.file)).rejects.toThrow();
  });

  it('refuses a request from another site', async () => {
    const c = await setup();
    const status = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ workspaceDir: '~/work' });
      const req = request(
        `${c.base}/api/kiro/settings`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Origin: 'https://evil.example',
            'Sec-Fetch-Site': 'cross-site',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(status).toBe(403);
    await expect(stat(c.file)).rejects.toThrow();
  });
});
