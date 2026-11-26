// Test fixture: a stdio MCP server that starts and never answers.
//
// Usage: node silent-mcp-server.mjs <pidFile>
//
// It writes its pid to <pidFile> and a line to stderr, reads stdin, and stays alive
// until something stops it.
import { appendFileSync } from 'node:fs';

const [pidFile] = process.argv.slice(2);
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);
process.stderr.write('silent server is starting\n');
process.stdin.resume();
setInterval(() => {}, 60_000);
