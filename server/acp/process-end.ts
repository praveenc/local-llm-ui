/**
 * Runs cleanup functions when the dev server process ends, also on Ctrl+C or a closed terminal.
 *
 * Node runs `exit` listeners after process.exit() and after Vite's SIGTERM handler. It does not
 * run them when SIGINT or SIGHUP end the process, and Vite handles neither. The Kiro processes
 * run in process groups of their own (`detached`), so the terminal's SIGINT does not reach them.
 * This module adds SIGINT and SIGHUP listeners that run the cleanups, remove themselves, and send
 * the signal again, so the process still ends as it would without them.
 *
 * Cleanups must be synchronous: they run inside `exit` and inside a signal listener.
 */

const cleanups = new Set<() => void>();
const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGHUP'];
let installed = false;

function runCleanups(): void {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // A cleanup must not stop the others
    }
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  process.once('exit', runCleanups);
  for (const signal of SIGNALS) {
    const onSignal = (): void => {
      runCleanups();
      process.off(signal, onSignal);
      // With no other listener, the signal ends the process as it would without this module
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

/** Registers a cleanup. Returns a function that removes it. */
export function onProcessEnd(cleanup: () => void): () => void {
  install();
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}
