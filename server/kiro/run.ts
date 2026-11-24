/**
 * Runs kiro-cli with fixed arguments. No shell: the arguments are never parsed by a shell.
 */
import { execFile } from 'child_process';

export interface RunResult {
  /** Exit code, or null when a signal ended the process */
  code: number | null;
  stdout: string;
  stderr: string;
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// CSI sequences (colors, cursor) and OSC sequences (titles, links)
const ANSI_PATTERN = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  'g'
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Resolves with the exit code and the output, also when the code is not 0. Rejects only when
 * the process cannot start or does not end in time.
 */
export function runKiro(
  file: string,
  args: string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        env: options.env,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const result = (code: number | null): RunResult => ({
          code,
          stdout: stripAnsi(stdout),
          stderr: stripAnsi(stderr),
        });
        if (!error) {
          resolve(result(0));
          return;
        }
        if (error.killed) {
          reject(new Error(`timed out after ${options.timeoutMs / 1000} s`));
          return;
        }
        if (typeof error.code === 'number') {
          resolve(result(error.code));
          return;
        }
        // Spawn error (ENOENT, EACCES) or output over maxBuffer
        reject(new Error(error.message));
      }
    );
  });
}
