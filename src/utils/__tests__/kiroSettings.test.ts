import { describe, expect, it } from 'vitest';

import {
  KIRO_FOLDER_MESSAGES as M,
  MAX_KIRO_FOLDER_CHARS,
  checkKiroFolderText,
  displayKiroFolder,
  expandKiroFolder,
  isInsideFolder,
  kiroFolderPlaceProblem,
  normalizeAbsolutePath,
  parseKiroSettingsFile,
  parseKiroSettingsRequest,
} from '../kiroSettings';

const home = '/home/you';
const places = { home, platform: 'linux', defaultDir: `${home}/.local-llm-ui/kiro` };

describe('parseKiroSettingsRequest', () => {
  it('takes a folder or null', () => {
    expect(parseKiroSettingsRequest({ workspaceDir: ' ~/projects/demo ' })).toEqual({
      ok: true,
      value: { workspaceDir: '~/projects/demo' },
    });
    expect(parseKiroSettingsRequest({ workspaceDir: null, other: 1 })).toEqual({
      ok: true,
      value: { workspaceDir: null },
    });
  });

  it('refuses other shapes and bad text', () => {
    for (const body of [null, [], 'x', {}, { workspaceDir: 1 }, { workspaceDir: {} }]) {
      expect(parseKiroSettingsRequest(body)).toEqual({ ok: false, error: M.notText });
    }
    expect(parseKiroSettingsRequest({ workspaceDir: 'relative/path' })).toEqual({
      ok: false,
      error: M.notAbsolute,
    });
  });
});

describe('checkKiroFolderText', () => {
  it('passes a home or absolute path', () => {
    expect(checkKiroFolderText('~/projects/demo')).toBeUndefined();
    expect(checkKiroFolderText('/tmp/work')).toBeUndefined();
    // /var is checked on the server: some homes are in /var/home
    expect(checkKiroFolderText('/var/home/you/work')).toBeUndefined();
  });

  it('gives the message of each problem', () => {
    expect(checkKiroFolderText('  ')).toBe(M.empty);
    expect(checkKiroFolderText(`/${'a'.repeat(MAX_KIRO_FOLDER_CHARS)}`)).toBe(M.tooLong);
    expect(checkKiroFolderText('/tmp/a\nb')).toBe(M.badCharacters);
    expect(checkKiroFolderText('/tmp/a\u202eb')).toBe(M.badCharacters);
    expect(checkKiroFolderText('/tmp/a\u200bb')).toBe(M.badCharacters);
    expect(checkKiroFolderText('~')).toBe(M.home);
    expect(checkKiroFolderText('~/')).toBe(M.home);
    expect(checkKiroFolderText('~other/x')).toBe(M.notAbsolute);
    expect(checkKiroFolderText('work')).toBe(M.notAbsolute);
    expect(checkKiroFolderText('/')).toBe(M.system);
    expect(checkKiroFolderText('/etc')).toBe(M.system);
    expect(checkKiroFolderText('/tmp/../etc/x')).toBe(M.system);
    expect(checkKiroFolderText('/usr/local/src')).toBe(M.system);
  });
});

describe('paths', () => {
  it('normalizes and expands', () => {
    expect(normalizeAbsolutePath('//a/./b/../c/')).toBe('/a/c');
    expect(normalizeAbsolutePath('/..')).toBe('/');
    expect(expandKiroFolder('~/a/../b', home)).toBe('/home/you/b');
    expect(expandKiroFolder('/x//y', home)).toBe('/x/y');
    expect(expandKiroFolder('x', home)).toBeUndefined();
  });

  it('tells inside from a name that only starts the same', () => {
    expect(isInsideFolder('/etc', '/etc')).toBe(true);
    expect(isInsideFolder('/etc/x', '/etc')).toBe(true);
    expect(isInsideFolder('/etcetera', '/etc')).toBe(false);
    expect(isInsideFolder('/a', '/')).toBe(true);
  });

  it('writes the home folder as ~', () => {
    expect(displayKiroFolder('/home/you/w', home)).toBe('~/w');
    expect(displayKiroFolder('/home/you', home)).toBe('~');
    expect(displayKiroFolder('/home/your/w', home)).toBe('/home/your/w');
  });
});

describe('kiroFolderPlaceProblem', () => {
  it('allows a folder in the home folder, the default folder, and /tmp on Linux', () => {
    expect(kiroFolderPlaceProblem('/home/you/projects/demo', places)).toBeUndefined();
    expect(kiroFolderPlaceProblem(places.defaultDir, places)).toBeUndefined();
    expect(kiroFolderPlaceProblem(`${places.defaultDir}/sub`, places)).toBeUndefined();
    expect(kiroFolderPlaceProblem('/tmp/work', places)).toBeUndefined();
  });

  it('refuses the root, the home folder, and a folder that holds it', () => {
    expect(kiroFolderPlaceProblem('/', places)).toBe(M.system);
    expect(kiroFolderPlaceProblem(home, places)).toBe(M.home);
    expect(kiroFolderPlaceProblem('/home', places)).toBe(M.home);
  });

  it('refuses the settings folders and the rest of ~/.local-llm-ui', () => {
    for (const name of ['.kiro', '.aws/sso', '.ssh', '.config/x', '.local-llm-ui']) {
      expect(kiroFolderPlaceProblem(`${home}/${name}`, places)).toBe(M.settings);
    }
    expect(kiroFolderPlaceProblem(`${home}/.local-llm-ui/other`, places)).toBe(M.settings);
    expect(kiroFolderPlaceProblem(`${home}/.kirofiles`, places)).toBeUndefined();
  });

  it('refuses system folders, and the macOS ones only on macOS', () => {
    expect(kiroFolderPlaceProblem('/etc/x', places)).toBe(M.system);
    expect(kiroFolderPlaceProblem('/var/tmp', places)).toBe(M.system);
    expect(kiroFolderPlaceProblem('/Volumes/disk', places)).toBeUndefined();
    const mac = {
      home: '/Users/you',
      platform: 'darwin',
      defaultDir: '/Users/you/.local-llm-ui/kiro',
    };
    expect(kiroFolderPlaceProblem('/Volumes/disk', mac)).toBe(M.system);
    expect(kiroFolderPlaceProblem('/private/tmp/work', mac)).toBe(M.system);
    expect(kiroFolderPlaceProblem('/Users/you/work', mac)).toBeUndefined();
  });

  it('skips the system list for a home folder in /var/home', () => {
    const fedora = {
      home: '/var/home/you',
      platform: 'linux',
      defaultDir: '/var/home/you/.local-llm-ui/kiro',
    };
    expect(kiroFolderPlaceProblem('/var/home/you/work', fedora)).toBeUndefined();
    expect(kiroFolderPlaceProblem('/var/home/you/.ssh', fedora)).toBe(M.settings);
    expect(kiroFolderPlaceProblem('/var/lib', fedora)).toBe(M.system);
  });
});

describe('parseKiroSettingsFile', () => {
  it('reads a stored real path or the default', () => {
    expect(parseKiroSettingsFile({ workspaceDir: '/home/you/w' })).toEqual({
      workspaceDir: '/home/you/w',
    });
    expect(parseKiroSettingsFile({ workspaceDir: null })).toEqual({ workspaceDir: null });
    expect(parseKiroSettingsFile({})).toEqual({ workspaceDir: null });
  });

  it('refuses a file that the app did not write', () => {
    for (const bad of [
      null,
      [],
      { workspaceDir: 3 },
      { workspaceDir: '~/w' },
      { workspaceDir: '/a/../b' },
      { workspaceDir: '/a\n' },
    ]) {
      expect(parseKiroSettingsFile(bad)).toBeUndefined();
    }
  });
});
