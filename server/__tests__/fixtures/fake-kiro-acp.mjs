// A fake `kiro-cli acp` for tests. It speaks newline-delimited JSON-RPC on stdio like kiro-cli 3.
// The messages are small hand-made copies of the shapes that kiro-cli 3.5.0 sends.
//
// FAKE_KIRO_MODE: ok | signed-out | auth-required | no-load | hang-new | crash-on-prompt |
//   ignore-cancel | autopilot-stuck | autopilot-flip
// auth-required: initialize succeeds, session/new answers -32000 'Authentication required'
// FAKE_KIRO_HANG_NEW_AT: with hang-new, the session/new call (1-based) that hangs (default 1)
// autopilot-flip: a prompt turns Autopilot on (with a config_option_update), then waits for cancel
// FAKE_KIRO_STATE_DIR: folder for marker files (hang-new hangs on the first process only)
// FAKE_KIRO_LOG: file; each received message is appended as one JSON line {pid, msg}
// FAKE_KIRO_SPAWN_GRANDCHILD=1: start a long-lived process in its own process group
// FAKE_KIRO_PIDS: file that gets {pid, grandchild}
// Prompt text: TOOL asks for a permission, WAIT waits for session/cancel, SLOW streams slowly.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_KIRO_MODE ?? 'ok';
const stateDir = process.env.FAKE_KIRO_STATE_DIR;
const logFile = process.env.FAKE_KIRO_LOG;

if (process.argv.slice(2).join(' ') !== 'acp --agent-engine v3 --auth-method cli') {
  process.stderr.write(`unexpected arguments: ${process.argv.slice(2).join(' ')}\n`);
  process.exit(2);
}

let grandchild;
if (process.env.FAKE_KIRO_SPAWN_GRANDCHILD === '1') {
  grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
    detached: true,
    stdio: 'ignore',
  });
  grandchild.unref();
}
if (process.env.FAKE_KIRO_PIDS) {
  writeFileSync(
    process.env.FAKE_KIRO_PIDS,
    JSON.stringify({ pid: process.pid, grandchild: grandchild?.pid })
  );
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
const notify = (method, params) => send({ method, params });
const update = (sessionId, u) => notify('session/update', { sessionId, update: u });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) =>
  logFile && appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, msg })}\n`);

// Like the OpenSSL warning that kiro-cli prints, but on stdout
process.stdout.write('this line is not JSON\n');

const options = (s) => [
  {
    type: 'select',
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: s.mode,
    options: [{ value: 'vibe', name: 'Default', description: 'General coding assistance' }],
  },
  {
    type: 'select',
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: s.model,
    options: [
      { value: 'auto', name: 'auto', _meta: { kiro: { rateMultiplier: 1 } } },
      { value: 'claude-fake-1', name: 'claude-fake-1', _meta: { kiro: { rateMultiplier: 1.3 } } },
      { value: 'stuck-model', name: 'stuck-model' },
    ],
  },
  {
    type: 'select',
    id: 'autopilot',
    name: 'Autopilot',
    currentValue: s.autopilot,
    options: [
      { value: 'on', name: 'Autopilot', description: 'Agent executes tools without confirmation' },
      {
        value: 'off',
        name: 'Supervised',
        description: 'Agent asks for approval before file changes',
      },
    ],
  },
];

const sessions = new Map();
let newCalls = 0;
const cancelled = new Set();
const waiters = new Map(); // agent request id -> resolve
let agentRequestId = 1000;

function open(sessionId) {
  const s = { mode: 'vibe', model: 'auto', autopilot: 'on' };
  sessions.set(sessionId, s);
  notify('_kiro/mcp/status', { sessionId, servers: [{ name: 'fake', status: 'connecting' }] });
  update(sessionId, { sessionUpdate: 'config_option_update', configOptions: options(s) });
  notify('_kiro/mcp/status', { sessionId, servers: [{ name: 'fake', status: 'connected' }] });
  return s;
}

function askAgent(method, params) {
  const id = agentRequestId++;
  send({ id, method, params });
  return new Promise((resolve) => waiters.set(id, resolve));
}

async function runPrompt(id, { sessionId, prompt }) {
  const text = prompt.map((b) => b.text ?? '').join(' ');
  const s = sessions.get(sessionId);
  if (!s) return send({ id, error: { code: -32602, message: 'Session not found' } });
  cancelled.delete(sessionId);
  const meta = (kind, extra) => ({
    sessionUpdate: 'session_info_update',
    _meta: { kiro: { kind, ...extra } },
  });
  update(sessionId, meta('turn_start', {}));
  update(sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: `thinking about ${sessionId}` },
  });
  notify('_kiro/mcp/status', { sessionId, servers: [] });
  if (mode === 'autopilot-flip') {
    s.autopilot = 'on';
    update(sessionId, { sessionUpdate: 'config_option_update', configOptions: options(s) });
    while (!cancelled.has(sessionId)) await sleep(10);
    return send({ id, result: { stopReason: 'cancelled' } });
  }
  if (mode === 'crash-on-prompt') {
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'part' },
    });
    setTimeout(() => process.exit(3), 20);
    return;
  }
  if (text.includes('WAIT')) {
    while (!cancelled.has(sessionId)) await sleep(10);
    return send({ id, result: { stopReason: 'cancelled' } });
  }
  if (text.includes('TOOL')) {
    const toolCallId = `run_command_${randomUUID()}`;
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Create hello.txt',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'echo hi > hello.txt' },
    });
    const answer = await askAgent('session/request_permission', {
      sessionId,
      toolCall: { toolCallId, status: 'pending', title: 'echo hi > hello.txt' },
      // The ids do not say the kind: a client must choose by kind
      options: [
        { optionId: 'o1', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'o2', name: 'Deny', kind: 'reject_once' },
        { optionId: 'o3', name: 'Allow', kind: 'allow_once' },
        { optionId: 'o4', name: 'Always deny', kind: 'reject_always' },
      ],
      _meta: { kiro: { toolId: 'run_command' } },
    });
    const allowed =
      answer?.result?.outcome?.optionId === 'o1' || answer?.result?.outcome?.optionId === 'o3';
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: allowed ? 'completed' : 'failed',
      rawOutput: { message: allowed ? 'hi' : 'The user rejected this tool call.' },
    });
  }
  const words = ['echo', ':', ' ', text];
  for (const word of words) {
    if (cancelled.has(sessionId)) return send({ id, result: { stopReason: 'cancelled' } });
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: word },
    });
    await sleep(text.includes('SLOW') ? 40 : 5);
  }
  update(sessionId, {
    sessionUpdate: 'session_info_update',
    title: 'Fake title',
    _meta: { kiro: { kind: 'focus_update', title: 'Fake title' } },
  });
  update(
    sessionId,
    meta('context_usage', { usagePercentage: 4.2, contextUsage: { usagePercentage: 4.2 } })
  );
  update(
    sessionId,
    meta('turn_completion', {
      promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: 0.05 }],
      elapsedTime: 1200,
      status: 'success',
    })
  );
  update(
    sessionId,
    meta('session_usage', { credits: [{ usage: 0.05, unit: 'credit', unitPlural: 'credits' }] })
  );
  send({ id, result: { stopReason: 'end_turn' } });
}

const handlers = {
  initialize() {
    if (mode === 'signed-out') {
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false },
          sessionCapabilities: {},
        },
        authMethods: [
          { id: 'kiro-login', name: 'Kiro Login', description: "Run 'kiro-cli login'" },
        ],
        agentInfo: { name: 'Kiro CLI Agent', version: '3.5.0' },
      };
    }
    notify('_kiro/memory/syncStatus', { state: 'notStarted' });
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: mode !== 'no-load',
        promptCapabilities: { image: true, embeddedContext: true },
        sessionCapabilities: { list: {}, close: {}, delete: {}, fork: {} },
      },
      authMethods: [{ id: 'aws-builder-id', name: 'AWS Builder ID' }],
      agentInfo: { name: 'Kiro CLI Agent', version: '3.5.0' },
    };
  },
  'session/new'(params) {
    if (mode === 'signed-out' || mode === 'auth-required') {
      throw { code: -32000, message: 'Authentication required. Not logged in.' };
    }
    newCalls += 1;
    const hangAt = Number(process.env.FAKE_KIRO_HANG_NEW_AT ?? '1');
    if (mode === 'hang-new' && stateDir && newCalls === hangAt) {
      const marker = path.join(stateDir, 'hung-once');
      if (!existsSync(marker)) {
        writeFileSync(marker, String(process.pid));
        return new Promise(() => {});
      }
    }
    const sessionId = `sess_${randomUUID()}`;
    const s = open(sessionId);
    // Like Kiro: context usage arrives outside a prompt, after session/new
    setTimeout(
      () =>
        update(sessionId, {
          sessionUpdate: 'session_info_update',
          _meta: { kiro: { kind: 'context_usage', usagePercentage: 1.5 } },
        }),
      0
    );
    return {
      sessionId,
      modes: {},
      configOptions: options(s),
      _meta: { workspacePaths: [params.cwd] },
    };
  },
  'session/load'({ sessionId }) {
    const s = open(sessionId);
    return {
      modes: {},
      configOptions: options(s),
      _meta: { id: sessionId, title: 'Fake title', contextUsage: { usagePercentage: 3.5 } },
    };
  },
  'session/set_config_option'({ sessionId, configId, value }) {
    const s = sessions.get(sessionId);
    if (!s) throw { code: -32602, message: 'Session not found' };
    // Like Kiro: no validation
    if (configId === 'autopilot' && mode === 'autopilot-stuck') {
      // stays on
    } else if (value !== 'stuck-model') {
      s[configId] = value;
    }
    return { configOptions: options(s) };
  },
  '_kiro/account/getUsage'() {
    return { success: true, data: { planName: 'FAKE', usageBreakdowns: [] } };
  },
  'session/delete'({ sessionId }) {
    sessions.delete(sessionId);
    return {};
  },
};

function onMessage(msg) {
  log(msg);
  if (msg.method === undefined && msg.id !== undefined) {
    waiters.get(msg.id)?.(msg);
    waiters.delete(msg.id);
    return;
  }
  if (msg.method === 'session/cancel') {
    if (mode !== 'ignore-cancel') cancelled.add(msg.params.sessionId);
    return;
  }
  if (msg.id === undefined) return;
  if (msg.method === 'session/prompt') {
    void runPrompt(msg.id, msg.params);
    return;
  }
  const handler = handlers[msg.method];
  if (!handler) return send({ id: msg.id, error: { code: -32601, message: 'Method not found' } });
  Promise.resolve()
    .then(() => handler(msg.params))
    .then(
      (result) => send({ id: msg.id, result }),
      (error) => send({ id: msg.id, error })
    );
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) onMessage(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
