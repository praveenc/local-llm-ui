/**
 * Starts `kiro-cli acp` in its own process group and stops it with all its process groups.
 *
 * One `kiro-cli acp` starts 20 to 26 processes (the user's MCP servers). The v3 engine runs in a
 * process group of its own, and a wrapper script adds one more. A stop must end all of them.
 */
import { execFile, execFileSync, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

export const KIRO_ACP_ARGS = ['acp', '--agent-engine', 'v3', '--auth-method', 'cli'];

const STDERR_RING_BYTES = 64 * 1024;
const PS_ARGS = ['-A', '-o', 'pid=,ppid=,pgid='];
const PS_MAX_BUFFER = 64 * 1024 * 1024;

export interface KiroChild {
  child: ChildProcess;
  pid: number;
  /** The last 64 KB of stderr, for diagnostics. Never logged as a whole. */
  stderrTail(): string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Process groups of live Kiro children, killed synchronously if the app exits */
const liveChildren = new Set<ChildProcess>();
let exitHandlerInstalled = false;

function installExitHandler(): void {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  process.once('exit', () => {
    for (const child of liveChildren) {
      const pid = child.pid;
      if (pid === undefined) continue;
      let groups = [pid];
      try {
        const out = execFileSync('ps', PS_ARGS, {
          encoding: 'utf8',
          maxBuffer: PS_MAX_BUFFER,
          timeout: 1000,
        });
        groups = descendantGroups(parsePs(out), pid);
      } catch {
        // Kill at least the child's own group
      }
      signalGroups(groups, 'SIGKILL');
    }
  });
}

export function spawnKiroAcp(
  binaryPath: string,
  options: { cwd: string; env: NodeJS.ProcessEnv }
): KiroChild {
  const child = spawn(binaryPath, KIRO_ACP_ARGS, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    shell: false,
    windowsHide: true,
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      liveChildren.delete(child);
      resolve({ code, signal });
    });
    // A spawn error (ENOENT, EACCES) has no 'exit' event
    child.once('error', () => {
      if (child.pid === undefined) resolve({ code: null, signal: null });
    });
  });
  let ring = Buffer.alloc(0);
  child.stderr?.on('data', (chunk: Buffer) => {
    ring = Buffer.concat([ring, chunk]);
    if (ring.length > STDERR_RING_BYTES) ring = ring.subarray(ring.length - STDERR_RING_BYTES);
  });
  if (child.pid !== undefined) {
    installExitHandler();
    liveChildren.add(child);
  }
  return {
    child,
    pid: child.pid ?? -1,
    stderrTail: () => ring.toString('utf8'),
    exited,
  };
}

interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
}

export function parsePs(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split('\n')) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && Number.isSafeInteger(pgid)) {
      rows.push({ pid, ppid, pgid });
    }
  }
  return rows;
}

/**
 * The child's group and the group of every descendant, without the group of this app
 * and without group 0 or 1.
 */
export function descendantGroups(rows: PsRow[], root: number): number[] {
  const own = rows.find((r) => r.pid === process.pid)?.pgid;
  const byParent = new Map<number, PsRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.ppid);
    if (list) list.push(row);
    else byParent.set(row.ppid, [row]);
  }
  const groups = new Set<number>([root]);
  const queue = [root];
  const seen = new Set<number>(queue);
  while (queue.length) {
    const pid = queue.shift()!;
    for (const row of byParent.get(pid) ?? []) {
      if (seen.has(row.pid)) continue;
      seen.add(row.pid);
      groups.add(row.pgid);
      queue.push(row.pid);
    }
  }
  return [...groups].filter((g) => g > 1 && g !== own);
}

function snapshotGroups(root: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('ps', PS_ARGS, { encoding: 'utf8', maxBuffer: PS_MAX_BUFFER }, (error, stdout) => {
      resolve(error ? [root] : descendantGroups(parsePs(stdout), root));
    });
  });
}

function signalGroups(groups: number[], signal: NodeJS.Signals): void {
  for (const group of groups) {
    try {
      process.kill(-group, signal);
    } catch {
      // ESRCH: gone. EPERM: not ours (any more).
    }
  }
}

function groupAlive(group: number): boolean {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    // ESRCH, or EPERM: the group number now belongs to another user
    return false;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)).unref());

/**
 * Closes stdin, sends SIGTERM to every group after graceMs and SIGKILL after killMs.
 * Resolves when the child has exited and its groups are gone, or after killMs + 1 s.
 */
export async function stopProcessTree(
  child: ChildProcess,
  options: { graceMs?: number; killMs?: number } = {}
): Promise<void> {
  const graceMs = options.graceMs ?? 1000;
  const killMs = options.killMs ?? 5000;
  const pid = child.pid;
  if (pid === undefined) return;
  const start = Date.now();
  const childExited = () => child.exitCode !== null || child.signalCode !== null;
  const exited = childExited()
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once('exit', () => resolve()));

  // Snapshot first: once the child exits, its children are reparented and cannot be found
  const groups = await snapshotGroups(pid);
  const allGone = () => childExited() && !groups.some(groupAlive);

  try {
    child.stdin?.end();
  } catch {
    // stdin is already closed
  }

  const waitUntil = async (deadline: number): Promise<boolean> => {
    while (!allGone()) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await Promise.race([exited, sleep(Math.min(left, 25))]);
    }
    return true;
  };

  if (await waitUntil(start + graceMs)) return;
  signalGroups(groups.filter(groupAlive), 'SIGTERM');
  if (await waitUntil(start + killMs)) return;
  signalGroups(groups.filter(groupAlive), 'SIGKILL');
  await waitUntil(start + killMs + 1000);
}
