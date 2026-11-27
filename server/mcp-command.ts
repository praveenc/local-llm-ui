/**
 * Find the program that a local (stdio) MCP server starts (D15 (a)).
 *
 * A name is looked up on the PATH of the child's own environment (the safe env with the
 * server's env on top, so a PATH that the user sets wins), the same PATH that the child gets.
 * The manager then spawns the absolute path that this returns, so the file that was checked is
 * the file that runs. A path that starts with `/` or `~/` is checked as it is. `~/` is the home
 * folder of the dev server (`os.homedir()`), never a HOME from the server's env.
 *
 * The program must be a file after links and executable. No `realpath`: a program such as a
 * virtualenv `python` finds its environment from the path that it was started with. The lookup
 * is case-sensitive. Error texts name the command as typed (trimmed), never the expanded path.
 */
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute } from 'node:path';

import { classifyCommand } from '../src/utils/mcpCommand.ts';

/** True when `file` is a file (links followed) that this process may run */
async function isProgram(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `dir` and `name` with one `/` between them. No normalize: `..` after a link must stay. */
const inFolder = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);

/**
 * The absolute path of the program to spawn for `command`. Throws "Command not found: x" for a
 * name with no match on PATH, "x is not a program" for a `/` or `~/` path that is missing, a
 * folder, or not executable, and the shape error for anything else.
 */
export async function resolveCommand(
  command: string,
  env: Record<string, string | undefined>
): Promise<string> {
  const shape = classifyCommand(command);
  switch (shape.kind) {
    case 'invalid':
      throw new Error(shape.error);
    case 'absolute':
    case 'home': {
      const file =
        shape.kind === 'home' ? inFolder(homedir(), shape.command.slice(2)) : shape.command;
      if (await isProgram(file)) return file;
      throw new Error(`${shape.command} is not a program`);
    }
    case 'name': {
      // The env comes from the request: a PATH that is not text finds nothing
      const pathValue = typeof env.PATH === 'string' ? env.PATH : '';
      // An empty or relative entry means a folder relative to where the dev server started
      const dirs = pathValue.split(delimiter).filter((dir) => dir && isAbsolute(dir));
      for (const dir of dirs) {
        const file = inFolder(dir, shape.command);
        if (await isProgram(file)) return file;
      }
      throw new Error(`Command not found: ${shape.command}`);
    }
  }
}
