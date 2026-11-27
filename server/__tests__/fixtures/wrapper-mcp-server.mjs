// Test fixture: a wrapper that starts the real server as its own child, the way
// `npm exec` (and so `npx`) does. The server inherits the wrapper's stdin, stdout,
// and stderr, so it talks to the app directly.
//
// Usage: node wrapper-mcp-server.mjs <pidFile> <forward|no-forward> <script> [args...]
//
// forward:    like npm, the wrapper passes SIGTERM on to the server and exits with it.
// no-forward: the wrapper stops on SIGTERM and leaves the server running.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const [pidFile, mode, script, ...args] = process.argv.slice(2);
appendFileSync(pidFile, `${process.pid}\n`);

const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });

if (mode === 'forward') {
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
// Exit with the server, as npm does (a server stopped by a signal gives code 1)
child.on('exit', (code) => process.exit(code ?? 1));
