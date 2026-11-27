/**
 * The rules for the command and the arguments of a local (stdio) MCP server, shared by the
 * server (`server/mcp-manager.ts`), the form (`validateMCPServerConfig`), and the import.
 * Pure helper: no DOM and no Node imports. Only the server can look a name up on PATH
 * (`server/mcp-command.ts`).
 *
 * A command is a program name (no `/` and no `\`), found on the child's PATH by the server, or
 * a full path that starts with `/` or `~/`. Anything else (`./server`, `bin/server`, `~`,
 * `~user/x`, a `\`) is refused. Linux and macOS only.
 */

/** The text for a command that is not a name and not a full path */
export const COMMAND_SHAPE_ERROR = 'Use a program name or a full path that starts with / or ~/';

/** The text for a command with control characters (spawn cannot pass them) */
export const COMMAND_CHARACTERS_ERROR = 'Command contains characters that the app does not allow';

/** The text for an empty command */
export const COMMAND_REQUIRED_ERROR = 'Command is required';

/** What a command is. `command` is the trimmed text; the app uses it for everything. */
export type CommandShape =
  | { kind: 'name'; command: string }
  | { kind: 'absolute'; command: string }
  | { kind: 'home'; command: string }
  | { kind: 'invalid'; command: string; error: string };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

/** Sort a command into a name, a full path, a `~/` path, or a refused text */
export function classifyCommand(raw: string): CommandShape {
  const command = raw.trim();
  if (!command) return { kind: 'invalid', command, error: COMMAND_REQUIRED_ERROR };
  if (CONTROL_CHARACTERS.test(command)) {
    return { kind: 'invalid', command, error: COMMAND_CHARACTERS_ERROR };
  }
  if (command.includes('\\')) return { kind: 'invalid', command, error: COMMAND_SHAPE_ERROR };
  if (command.startsWith('/')) return { kind: 'absolute', command };
  if (command.startsWith('~/') && command.length > 2) return { kind: 'home', command };
  if (command.includes('/') || command.startsWith('~')) {
    return { kind: 'invalid', command, error: COMMAND_SHAPE_ERROR };
  }
  return { kind: 'name', command };
}

/**
 * Characters that the app refuses in an argument. No shell runs, so they do nothing there; the
 * rule stays as a second line of defense (SEC-01).
 */
export const SHELL_METACHAR_PATTERN = /[;&|`$(){}!<>]/;

/** The number (from 1) of the first argument with a refused character, or null */
export function findDisallowedArgument(args: readonly string[]): number | null {
  const index = args.findIndex((arg) => SHELL_METACHAR_PATTERN.test(arg));
  return index === -1 ? null : index + 1;
}

/** The error text for argument `n`. It never shows the value: an argument can hold a secret. */
export function argumentError(n: number): string {
  return `Argument ${n} contains characters that the app does not allow`;
}
