// Test fixture: a stdio MCP server that stops before it answers, like `npx` with an
// expired npm token.
//
// Usage: node exit-mcp-server.mjs <pidFile> <npm|quiet|signal|long>
//
// npm:    writes npm-like lines (with ANSI colours) to stderr and exits with code 1
// quiet:  exits with code 1 and writes nothing
// signal: stops itself with SIGTERM
// long:   writes one very long line to stderr and exits with code 1
import { appendFileSync } from 'node:fs';

const [pidFile, mode = 'npm'] = process.argv.slice(2);
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);

if (mode === 'npm') {
  const red = (text) => `\x1b[31m${text}\x1b[39m`;
  process.stderr.write(
    [
      'npm warn first line that the summary drops',
      `${red('npm error')} code E401`,
      '',
      `${red('npm error')} Unable to authenticate, your authentication token seems to be invalid.`,
      `${red('npm error')} To correct this please try logging in again with:`,
      `${red('npm error')}   npm login`,
      `${red('npm error')} A complete log of this run can be found in: /tmp/npm.log`,
      'npm error final line E401',
      '',
    ].join('\n')
  );
  process.exitCode = 1;
} else if (mode === 'quiet') {
  process.exitCode = 1;
} else if (mode === 'signal') {
  process.kill(process.pid, 'SIGTERM');
} else if (mode === 'long') {
  process.stderr.write(`${'x'.repeat(1000)}\n`);
  process.exitCode = 1;
}
