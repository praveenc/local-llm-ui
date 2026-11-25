/**
 * Starts `kiro-cli acp` in its own process group and stops it with all its process groups.
 *
 * One `kiro-cli acp` starts 20 to 26 processes (the user's MCP servers). The v3 engine runs in a
 * process group of its own, and a wrapper script adds one more. A stop must end all of them.
 */
import { execFile, execFileSync, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

import { onProcessEnd } from './process-end.ts';

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

/**
 * Kiro children and the process groups recorded for them while they were alive. An entry stays
 * until its groups are stopped, so the sync kill at the end of the app also reaches the groups of
 * a child that crashed.
 */
const tracked = new Map<ChildProcess, Set<number>>();
let removeEndHandler: (() => void) | undefined;

function childAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/** Sync SIGKILL of every tracked group. Runs on exit, SIGINT, and SIGHUP of the app. */
function killTrackedSync(): void {
  for (const [child, groups] of tracked) {
    const pid = child.pid;
    const all = new Set(groups);
    if (pid !== undefined) {
      all.add(pid);
      if (childAlive(child)) {
        try {
          const out = execFileSync('ps', PS_ARGS, {
            encoding: 'utf8',
            maxBuffer: PS_MAX_BUFFER,
            timeout: 1000,
          });
          for (const g of descendantGroups(parsePs(out), pid)) all.add(g);
        } catch {
          // Kill at least the recorded groups and the child's own group
        }
      }
    }
    signalGroups([...all], 'SIGKILL');
  }
}

function track(child: ChildProcess, pid: number): void {
  removeEndHandler ??= onProcessEnd(killTrackedSync);
  tracked.set(child, new Set([pid]));
}

function untrack(child: ChildProcess): void {
  tracked.delete(child);
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
      resolve({ code, signal });
    });
    // A spawn error (ENOENT, EACCES) has no 'exit' event
    child.once('error', () => {
      if (child.pid === undefined) resolve({ code: null, signal: null });
    });
  });
  let ring = Buffer.alloc(0);
  child.stderr?.on('error', () => undefined);
  child.stderr?.on('data', (chunk: Buffer) => {
    ring = Buffer.concat([ring, chunk]);
    if (ring.length > STDERR_RING_BYTES) ring = ring.subarray(ring.length - STDERR_RING_BYTES);
  });
  if (child.pid !== undefined) track(child, child.pid);
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

/** The groups of the root and all its descendants now, from one `ps` snapshot */
export function snapshotGroups(root: number): Promise<number[]> {
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

/**
 * Records the descendant groups of a live child, so that they can be stopped after the child
 * crashed (its children are then reparented and cannot be found from it).
 */
export async function recordProcessGroups(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || !childAlive(child)) return;
  const groups = await snapshotGroups(pid);
  // A snapshot after the exit could miss reparented children; it adds nothing wrong
  const set = tracked.get(child);
  if (!set) return;
  for (const g of groups) set.add(g);
}

/** The groups recorded for the child, with its own group */
export function recordedGroups(child: ChildProcess): number[] {
  return [...(tracked.get(child) ?? [])];
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)).unref());

/**
 * Closes stdin, sends SIGTERM to every group after graceMs and SIGKILL after killMs.
 * The groups are the recorded ones (see recordProcessGroups) and those of a snapshot now.
 * When the child has already exited, SIGTERM goes out at once.
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
  const groups = [...new Set([...recordedGroups(child), ...(await snapshotGroups(pid))])];
  const graceDeadline = childExited() ? start : start + graceMs;
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
      const pause = sleep(Math.min(left, 25));
      // Once the child has exited, `exited` is settled: racing it would spin without a pause
      await (childExited() ? pause : Promise.race([exited, pause]));
    }
    return true;
  };

  try {
    if (await waitUntil(graceDeadline)) return;
    signalGroups(groups.filter(groupAlive), 'SIGTERM');
    if (await waitUntil(start + killMs)) return;
    signalGroups(groups.filter(groupAlive), 'SIGKILL');
    await waitUntil(start + killMs + 1000);
  } finally {
    if (allGone()) untrack(child);
  }
}
