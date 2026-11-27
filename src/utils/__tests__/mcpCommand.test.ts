import { describe, expect, it } from 'vitest';

import {
  COMMAND_CHARACTERS_ERROR,
  COMMAND_REQUIRED_ERROR,
  COMMAND_SHAPE_ERROR,
  argumentError,
  classifyCommand,
  findDisallowedArgument,
} from '../mcpCommand';

describe('classifyCommand', () => {
  it('takes a program name', () => {
    expect(classifyCommand('my-mcp-server')).toEqual({ kind: 'name', command: 'my-mcp-server' });
  });

  it('takes a full path and a path in the home folder', () => {
    expect(classifyCommand('/opt/tools/server')).toEqual({
      kind: 'absolute',
      command: '/opt/tools/server',
    });
    expect(classifyCommand('~/bin/server')).toEqual({ kind: 'home', command: '~/bin/server' });
  });

  it.each(['./server', 'bin/server', '~', '~/', '~other/server', 'a\\b', 'C:\\tools\\x.exe'])(
    'refuses %s',
    (command) => {
      expect(classifyCommand(command)).toMatchObject({
        kind: 'invalid',
        error: COMMAND_SHAPE_ERROR,
      });
    }
  );

  it('refuses an empty command and one with only spaces', () => {
    expect(classifyCommand('')).toMatchObject({ kind: 'invalid', error: COMMAND_REQUIRED_ERROR });
    expect(classifyCommand('   ')).toMatchObject({
      kind: 'invalid',
      error: COMMAND_REQUIRED_ERROR,
    });
  });

  it('trims the spaces around the command once, and keeps the case', () => {
    expect(classifyCommand('  NODE ')).toEqual({ kind: 'name', command: 'NODE' });
    expect(classifyCommand(' /opt/x ')).toEqual({ kind: 'absolute', command: '/opt/x' });
  });

  it('keeps a space inside the command (the server then does not find it)', () => {
    expect(classifyCommand('npx -y pkg')).toEqual({ kind: 'name', command: 'npx -y pkg' });
  });

  it('refuses control characters', () => {
    expect(classifyCommand('node\u0000x')).toMatchObject({
      kind: 'invalid',
      error: COMMAND_CHARACTERS_ERROR,
    });
  });
});

describe('the argument check', () => {
  it.each([';', '&', '|', '`', '$', '(', ')', '{', '}', '!', '<', '>'])('refuses %s', (char) => {
    expect(findDisallowedArgument(['ok', `a${char}b`])).toBe(2);
  });

  it('gives the number of the first argument with a refused character', () => {
    expect(findDisallowedArgument(['-y', 'pkg', 'x$y', 'a;b'])).toBe(3);
    expect(findDisallowedArgument(['-y', '@scope/pkg', '/home/user/notes'])).toBeNull();
    expect(findDisallowedArgument([])).toBeNull();
  });

  it('names the argument number and not the value', () => {
    expect(argumentError(2)).toBe('Argument 2 contains characters that the app does not allow');
  });
});
