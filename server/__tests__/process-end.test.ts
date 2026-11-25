// @vitest-environment node
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../acp/process-end.ts');

let root: string;
let counter = 0;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'process-end-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Runs a Node process that registers a cleanup which writes a marker file. With `wait`, the
 * process stays alive and prints "ready"; else it ends by itself.
 */
async function runChild(options: { wait: boolean; removed?: boolean }) {
  counter += 1;
  const marker = path.join(root, `marker-${counter}`);
  const script = path.join(root, `child-${counter}.mjs`);
  await writeFile(
    script,
    `import { writeFileSync } from 'fs';
import { onProcessEnd } from ${JSON.stringify(MODULE)};
const remove = onProcessEnd(() => writeFileSync(${JSON.stringify(marker)}, 'cleaned'));
${options.removed ? 'remove();' : ''}
${options.wait ? "setInterval(() => {}, 1000); process.stdout.write('ready\\n');" : ''}
`
  );
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal }))
  );
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) resolve();
    });
    void exited.then(() => reject(new Error('the child ended before it was ready')));
  });
  // The child that ends by itself is never ready: that is not an error
  ready.catch(() => {});
  return { child, exited, ready, marker };
}

describe('onProcessEnd', () => {
  it.each(['SIGINT', 'SIGHUP'] as const)(
    'runs the cleanup on %s, and the process still ends by that signal',
    async (signal) => {
      const run = await runChild({ wait: true });
      await run.ready;
      run.child.kill(signal);
      expect(await run.exited).toEqual({ code: null, signal });
      expect(await readFile(run.marker, 'utf8')).toBe('cleaned');
    }
  );

  it('runs the cleanup on a normal exit', async () => {
    const run = await runChild({ wait: false });
    expect(await run.exited).toEqual({ code: 0, signal: null });
    expect(await readFile(run.marker, 'utf8')).toBe('cleaned');
  });

  it('does not run a cleanup that was removed', async () => {
    const run = await runChild({ wait: true, removed: true });
    await run.ready;
    run.child.kill('SIGINT');
    expect(await run.exited).toEqual({ code: null, signal: 'SIGINT' });
    expect(existsSync(run.marker)).toBe(false);
  });
});
