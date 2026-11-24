// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createServer } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroLoginEvent } from '../../src/utils/kiroLogin.ts';
import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import { createKiroProxy } from '../kiro-proxy.ts';
import type { KiroEnvironment } from '../kiro/binary.ts';
import { KiroLoginBusyError, createKiroLogin } from '../kiro/login.ts';
import type { KiroLogin } from '../kiro/login.ts';

const CODE = 'FVVW-JCBH';
const GOOD_URL = `https://view.awsapps.com/start/#/device?user_code=${CODE}`;

// A fake kiro-cli. `login` prints a code and a URL (with color codes and spinner noise), writes
// its pid, and waits for the file FAKE_APPROVE before it exits with 0. FAKE_MODE changes that.
const FAKE_SCRIPT = `#!${process.execPath}
const fs = require('fs');
const { spawn } = require('child_process');
const args = process.argv.slice(2);
const env = process.env;
if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, args.join(' ') + '\\n');
if (args[0] === '--version') {
  process.stdout.write('kiro-cli 3.6.0\\n');
} else if (args[0] === 'logout') {
  process.stdout.write('You are now logged out\\n');
  process.exitCode = Number(env.FAKE_LOGOUT_CODE ?? 0);
} else if (args[0] === 'login') {
  fs.writeFileSync(env.FAKE_PID_FILE, String(process.pid));
  if (env.FAKE_NO_COLOR_CHECK) fs.writeFileSync(env.FAKE_NO_COLOR_CHECK, String(env.NO_COLOR));
  if (env.FAKE_GRANDCHILD) {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(env.FAKE_GRANDCHILD, String(grandchild.pid));
  }
  const url = env.FAKE_URL ?? '${GOOD_URL}';
  if (env.FAKE_MODE === 'fail') {
    process.stdout.write('\\x1b[2K\\r▰▱▱ Logging in...');
    setTimeout(() => {
      process.stderr.write('\\x1b[31m' + (env.FAKE_ERROR ?? 'error: InvalidRequestException') + '\\x1b[0m\\n');
      process.exit(1);
    }, 100);
  } else {
    process.stdout.write('\\n\\x1b[1mConfirm the following code in the browser\\x1b[0m\\nCode: ${CODE}\\n\\nOpen this URL: ' + url + '\\n');
    process.stdout.write('\\r\\x1b[2K\\x1b[36m▰▱▱\\x1b[0m Logging in...');
    const timer = setInterval(() => {
      if (env.FAKE_APPROVE && fs.existsSync(env.FAKE_APPROVE)) {
        clearInterval(timer);
        process.stdout.write('\\r\\x1b[2KLogged in\\n');
        process.exit(0);
      }
    }, 50);
  }
}
`;

const SIGNED_OUT: KiroStatus = {
  state: 'signed-out',
  path: '~/.local/bin/kiro-cli',
  version: '3.6.0',
};
const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/.local/bin/kiro-cli',
  version: '3.6.0',
  account: { type: 'builder-id', email: 'me@example.com' },
};

let root: string;
let counter = 0;

interface Setup {
  environment: KiroEnvironment;
  log: string;
  pidFile: string;
  approve: string;
  grandchild: string;
  /** What the fake status reader returns */
  status: { current: KiroStatus };
  reader: { read: ReturnType<typeof vi.fn<(refresh?: boolean) => Promise<KiroStatus>>> };
}

async function setup(env: Record<string, string> = {}, withBinary = true): Promise<Setup> {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  const home = path.join(dir, 'home');
  const binDir = path.join(dir, 'bin');
  await mkdir(home, { recursive: true });
  await mkdir(binDir, { recursive: true });
  if (withBinary) {
    const file = path.join(binDir, 'kiro-cli');
    await writeFile(file, FAKE_SCRIPT);
    await chmod(file, 0o755);
  }
  const log = path.join(dir, 'runs.log');
  const pidFile = path.join(dir, 'pid');
  const approve = path.join(dir, 'approve');
  const grandchild = path.join(dir, 'grandchild');
  const status = { current: SIGNED_OUT };
  return {
    log,
    pidFile,
    approve,
    grandchild,
    status,
    reader: { read: vi.fn(async () => status.current) },
    environment: {
      env: {
        PATH: binDir,
        HOME: home,
        FAKE_LOG: log,
        FAKE_PID_FILE: pidFile,
        FAKE_APPROVE: approve,
        ...env,
      },
      home,
      platform: 'linux',
    },
  };
}

async function runs(log: string): Promise<string[]> {
  try {
    return (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => Promise<T | undefined> | T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error('timed out waiting for a condition');
    await sleep(20);
  }
}

async function readPid(file: string): Promise<number> {
  const text = await until(() => readFile(file, 'utf8').catch(() => undefined));
  return Number(text);
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function expectGone(pid: number): Promise<void> {
  await until(() => !isAlive(pid) || undefined, 6000);
  expect(isAlive(pid)).toBe(false);
}

const pids: number[] = [];
afterEach(() => {
  // Never leave a fake process behind when a test fails
  for (const pid of pids.splice(0)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Gone
    }
  }
});

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kiro-login-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function newLogin(s: Setup, timeoutMs?: number): KiroLogin {
  return createKiroLogin({ environment: s.environment, statusReader: s.reader, timeoutMs });
}

/** Starts a sign-in and collects its events */
function begin(
  login: KiroLogin,
  method: Parameters<KiroLogin['start']>[0] = { method: 'builder-id' }
) {
  const events: KiroLoginEvent[] = [];
  const finished = login.start(method, (event) => events.push(event));
  const has = (state: KiroLoginEvent['state']) => events.some((event) => event.state === state);
  return { events, finished, has };
}

describe('kiro login', () => {
  it('runs login with the Builder ID arguments, and nothing else', async () => {
    const s = await setup();
    const login = newLogin(s);
    const run = begin(login);
    pids.push(await readPid(s.pidFile));
    await until(() => run.has('code') || undefined);
    await writeFile(s.approve, '');
    await run.finished;
    expect(await runs(s.log)).toEqual(['login --license free --use-device-flow']);
  });

  it('runs login with the Identity Center arguments', async () => {
    const s = await setup({
      FAKE_URL: 'https://amzn.awsapps.com/start/#/device?user_code=FVVW-JCBH',
    });
    const login = newLogin(s);
    const run = begin(login, {
      method: 'identity-center',
      startUrl: 'https://amzn.awsapps.com/start',
      region: 'us-east-1',
    });
    pids.push(await readPid(s.pidFile));
    await until(() => run.has('code') || undefined);
    await writeFile(s.approve, '');
    await run.finished;
    expect(await runs(s.log)).toEqual([
      'login --license pro --identity-provider https://amzn.awsapps.com/start --region us-east-1 --use-device-flow',
    ]);
  });

  it('allows the host of the start URL when it is not on awsapps.com', async () => {
    const s = await setup({
      FAKE_URL: `https://ssoins-1.portal.us-east-1.app.aws/#/device?user_code=${CODE}`,
    });
    const login = newLogin(s);
    const run = begin(login, {
      method: 'identity-center',
      startUrl: 'https://ssoins-1.portal.us-east-1.app.aws',
      region: 'us-east-1',
    });
    pids.push(await readPid(s.pidFile));
    await until(() => run.has('code') || undefined);
    await writeFile(s.approve, '');
    await run.finished;
    expect(run.events.map((event) => event.state)).toEqual(['started', 'code', 'done']);
  });

  it('sends started, one code event, and done with the refreshed status', async () => {
    const s = await setup({ FAKE_NO_COLOR_CHECK: path.join(root, `nocolor-${counter + 1}`) });
    const login = newLogin(s);
    const run = begin(login);
    pids.push(await readPid(s.pidFile));
    await until(() => run.has('code') || undefined);
    expect(login.isRunning()).toBe(true);
    // The code is sent once, though the output also has spinner lines and color codes
    await sleep(200);
    expect(run.events).toEqual([
      { state: 'started' },
      { state: 'code', code: CODE, url: GOOD_URL },
    ]);

    s.status.current = SIGNED_IN;
    await writeFile(s.approve, '');
    await run.finished;
    expect(run.events.at(-1)).toEqual({ state: 'done', status: SIGNED_IN });
    expect(run.events).toHaveLength(3);
    expect(s.reader.read).toHaveBeenCalledWith(true);
    expect(login.isRunning()).toBe(false);
    expect(await readFile(path.join(root, `nocolor-${counter}`), 'utf8')).toBe('1');
  });

  it('does not log the code or the URL', async () => {
    const s = await setup();
    const info = vi.spyOn(console, 'info');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const login = newLogin(s);
    const run = begin(login);
    pids.push(await readPid(s.pidFile));
    await until(() => run.has('code') || undefined);
    await writeFile(s.approve, '');
    await run.finished;
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).toContain('[kiro] sign-in started');
    expect(logged).toContain('[kiro] sign-in ended: done');
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain('awsapps');
  });

  it('stops a login whose URL is not trusted', async () => {
    const s = await setup({ FAKE_URL: `https://awsapps.com.evil.example/?user_code=${CODE}` });
    const login = newLogin(s);
    const run = begin(login);
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    await run.finished;
    expect(run.events).toEqual([
      { state: 'started' },
      { state: 'error', message: 'Kiro CLI sent a sign-in page that the app does not trust' },
    ]);
    await expectGone(pid);
  });

  it('does not trust an app.aws URL that is not the start URL', async () => {
    const s = await setup({ FAKE_URL: `https://other.portal.us-east-1.app.aws/?c=${CODE}` });
    const login = newLogin(s);
    const run = begin(login, {
      method: 'identity-center',
      startUrl: 'https://ssoins-1.portal.us-east-1.app.aws',
      region: 'us-east-1',
    });
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    await run.finished;
    expect(run.events.at(-1)).toMatchObject({ state: 'error' });
    expect(run.has('code')).toBe(false);
    await expectGone(pid);
  });

  it('maps InvalidRequestException to a message about the start URL and the Region', async () => {
    const s = await setup({ FAKE_MODE: 'fail' });
    const run = begin(newLogin(s), {
      method: 'identity-center',
      startUrl: 'https://x.awsapps.com/start',
      region: 'us-east-1',
    });
    await run.finished;
    expect(run.events.at(-1)).toEqual({
      state: 'error',
      message: 'The start URL or the Region is not correct',
    });
  });

  it('shows the last line of output that is not a spinner line, without "error: "', async () => {
    const s = await setup({ FAKE_MODE: 'fail', FAKE_ERROR: `error: ${'x'.repeat(300)}` });
    const run = begin(newLogin(s));
    await run.finished;
    const last = run.events.at(-1);
    expect(last).toEqual({ state: 'error', message: 'x'.repeat(200) });
  });

  it('does not start when already signed in, or when Kiro CLI is old', async () => {
    const s = await setup();
    s.status.current = SIGNED_IN;
    const run = begin(newLogin(s));
    await run.finished;
    expect(run.events).toEqual([{ state: 'error', message: 'Already signed in' }]);
    expect(await runs(s.log)).toEqual([]);

    s.status.current = { state: 'unsupported', path: '~/kiro-cli', version: '2.37.1' };
    const old = begin(newLogin(s));
    await old.finished;
    expect(old.events).toEqual([{ state: 'error', message: 'Update Kiro CLI to version 3' }]);
    expect(await runs(s.log)).toEqual([]);
  });

  it('says so when Kiro CLI is not installed', async () => {
    const s = await setup({}, false);
    const run = begin(newLogin(s));
    await run.finished;
    expect(run.events).toEqual([{ state: 'error', message: 'Kiro CLI is not installed' }]);
  });

  it('times out, and the process group is gone', async () => {
    const s = await setup({ FAKE_GRANDCHILD: path.join(root, 'gc-timeout') });
    const login = newLogin(s, 400);
    const run = begin(login);
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    await run.finished;
    expect(run.events.at(-1)).toEqual({ state: 'error', message: 'Sign-in timed out' });
    await expectGone(pid);
    await expectGone(await readPid(path.join(root, 'gc-timeout')));
    expect(login.isRunning()).toBe(false);
  });

  it('cancels once, and the process group is gone', async () => {
    const s = await setup({ FAKE_GRANDCHILD: path.join(root, 'gc-cancel') });
    const login = newLogin(s);
    const run = begin(login);
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    await until(() => run.has('code') || undefined);
    expect(login.cancel()).toBe(true);
    expect(login.cancel()).toBe(false);
    await run.finished;
    expect(run.events.filter((event) => event.state === 'error')).toEqual([
      { state: 'error', message: 'Sign-in cancelled' },
    ]);
    await expectGone(pid);
    await expectGone(await readPid(path.join(root, 'gc-cancel')));
    expect(login.cancel()).toBe(false);
  });

  it('cancels a login that has not started its process yet', async () => {
    const s = await setup();
    const login = newLogin(s);
    const run = begin(login);
    expect(login.cancel()).toBe(true);
    await run.finished;
    expect(run.events).toEqual([{ state: 'error', message: 'Sign-in cancelled' }]);
    expect(await runs(s.log)).toEqual([]);
  });

  it('refuses a second sign-in while one runs', async () => {
    const s = await setup();
    const login = newLogin(s);
    const first = begin(login);
    // The slot is taken at once, before any await
    await expect(login.start({ method: 'builder-id' }, () => {})).rejects.toBeInstanceOf(
      KiroLoginBusyError
    );
    await expect(login.logout()).rejects.toBeInstanceOf(KiroLoginBusyError);
    pids.push(await readPid(s.pidFile));
    await until(() => first.has('code') || undefined);
    login.cancel();
    await first.finished;
    // After the end, a new sign-in can start
    const again = begin(login);
    await until(() => again.has('code') || undefined);
    login.cancel();
    await again.finished;
  });

  it('close() stops the process and sends no events', async () => {
    const s = await setup();
    const login = newLogin(s);
    const run = begin(login);
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    await until(() => run.has('code') || undefined);
    const seen = run.events.length;
    login.close();
    await run.finished;
    await expectGone(pid);
    expect(run.events).toHaveLength(seen);
    expect(login.isRunning()).toBe(false);
  });

  it('signs out with kiro-cli logout and returns the refreshed status', async () => {
    const s = await setup();
    s.status.current = SIGNED_IN;
    const login = newLogin(s);
    s.reader.read.mockImplementation(async () => {
      // The status is read after logout ran
      return (await runs(s.log)).includes('logout') ? SIGNED_OUT : SIGNED_IN;
    });
    await expect(login.logout()).resolves.toEqual(SIGNED_OUT);
    expect(await runs(s.log)).toEqual(['logout']);
    expect(s.reader.read).toHaveBeenCalledWith(true);
  });

  it('gives an error when logout fails and the account is still signed in', async () => {
    const s = await setup({ FAKE_LOGOUT_CODE: '1' });
    s.status.current = SIGNED_IN;
    await expect(newLogin(s).logout()).rejects.toThrow('Kiro CLI could not sign out');
  });
});

// ─── HTTP ────────────────────────────────────────────────────────────────────

/** Reads the SSE events of a response one at a time */
function eventStream(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(): Promise<KiroLoginEvent | 'DONE' | undefined> {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.replace(/^data: /, '');
          return data === '[DONE]' ? 'DONE' : (JSON.parse(data) as { login: KiroLoginEvent }).login;
        }
        const { value, done } = await reader.read();
        if (done) return undefined;
        buffer += decoder.decode(value, { stream: true });
      }
    },
    async all() {
      const events: Array<KiroLoginEvent | 'DONE'> = [];
      for (let event = await this.next(); event; event = await this.next()) events.push(event);
      return events;
    },
  };
}

describe('/api/kiro login routes', () => {
  let server: Server;
  let base: string;
  let s: Setup;
  let proxy: ReturnType<typeof createKiroProxy>;

  const post = (route: string, body?: unknown, signal?: AbortSignal) =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });

  beforeEach(async () => {
    s = await setup();
    proxy = createKiroProxy({ reader: s.reader, environment: s.environment });
    server = createServer((req, res) => {
      void proxy(req, res, () => {
        res.statusCode = 418;
        res.end('next');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    proxy.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('streams the events of a sign-in, then [DONE]', async () => {
    const response = await post('/api/kiro/login', { method: 'builder-id' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const stream = eventStream(response);
    expect(await stream.next()).toEqual({ state: 'started' });
    expect(await stream.next()).toEqual({ state: 'code', code: CODE, url: GOOD_URL });
    pids.push(await readPid(s.pidFile));
    s.status.current = SIGNED_IN;
    await writeFile(s.approve, '');
    expect(await stream.all()).toEqual([{ state: 'done', status: SIGNED_IN }, 'DONE']);
  });

  it('answers 400 for a body that is not valid', async () => {
    for (const body of [
      { method: 'nope' },
      { method: 'identity-center', startUrl: 'https://evil.example', region: 'us-east-1' },
      { method: 'identity-center', startUrl: 'https://x.awsapps.com/start', region: '--help' },
    ]) {
      const response = await post('/api/kiro/login', body);
      expect(response.status).toBe(400);
      expect(typeof ((await response.json()) as { error: unknown }).error).toBe('string');
    }
    const notJson = await fetch(`${base}/api/kiro/login`, { method: 'POST', body: '{' });
    expect(notJson.status).toBe(400);
    expect(await runs(s.log)).toEqual([]);
  });

  it('answers 413 for a body over 16 KB', async () => {
    const response = await post('/api/kiro/login', { method: 'x'.repeat(20_000) });
    expect(response.status).toBe(413);
  });

  it('answers 405 with Allow: POST for other methods', async () => {
    for (const route of ['/api/kiro/login', '/api/kiro/login/cancel', '/api/kiro/logout']) {
      const response = await fetch(`${base}${route}`);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect((await fetch(`${base}/api/kiro/other`, { method: 'POST' })).status).toBe(404);
  });

  it('answers 409 while a sign-in runs', async () => {
    const first = await post('/api/kiro/login', { method: 'builder-id' });
    const stream = eventStream(first);
    await stream.next();
    await stream.next();
    pids.push(await readPid(s.pidFile));
    const second = await post('/api/kiro/login', { method: 'builder-id' });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'A sign-in is already running' });
    expect((await post('/api/kiro/logout')).status).toBe(409);
    await post('/api/kiro/login/cancel');
    await stream.all();
  });

  it('stops the sign-in when the client goes away', async () => {
    const controller = new AbortController();
    const response = await post('/api/kiro/login', { method: 'builder-id' }, controller.signal);
    const stream = eventStream(response);
    await stream.next();
    await stream.next();
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    controller.abort();
    await expectGone(pid);
    // The slot is free again
    await until(async () => {
      const again = await post('/api/kiro/login/cancel');
      return ((await again.json()) as { cancelled: boolean }).cancelled === false || undefined;
    });
  });

  it('cancels with /login/cancel, and the stream ends with the cancel message', async () => {
    expect(await (await post('/api/kiro/login/cancel')).json()).toEqual({ cancelled: false });
    const response = await post('/api/kiro/login', { method: 'builder-id' });
    const stream = eventStream(response);
    await stream.next();
    await stream.next();
    const pid = await readPid(s.pidFile);
    pids.push(pid);
    const cancel = await post('/api/kiro/login/cancel');
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toEqual({ cancelled: true });
    expect(await stream.all()).toEqual([{ state: 'error', message: 'Sign-in cancelled' }, 'DONE']);
    await expectGone(pid);
  });

  it('signs out with /logout and returns the status', async () => {
    s.status.current = SIGNED_IN;
    s.reader.read.mockImplementation(async () =>
      (await runs(s.log)).includes('logout') ? SIGNED_OUT : SIGNED_IN
    );
    const response = await post('/api/kiro/logout');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(SIGNED_OUT);
    expect(await runs(s.log)).toEqual(['logout']);
  });

  it('still answers /status', async () => {
    const response = await fetch(`${base}/api/kiro/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SIGNED_OUT);
  });
});
