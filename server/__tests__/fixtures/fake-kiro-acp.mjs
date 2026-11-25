// A fake `kiro-cli acp` for tests. It speaks newline-delimited JSON-RPC on stdio like kiro-cli 3.
// The messages are small hand-made copies of the shapes that kiro-cli 3.5.0 sends.
//
// FAKE_KIRO_MODE: ok | signed-out | auth-required | no-load | hang-new | crash-on-prompt |
//   ignore-cancel | load-error
// load-error: session/load answers an ACP error, like a damaged session on disk
// auth-required: initialize succeeds, session/new answers -32000 'Authentication required'
// FAKE_KIRO_HANG_NEW_AT: with hang-new, the session/new call (1-based) that hangs (default 1)
// FAKE_KIRO_STATE_DIR: folder for marker files (hang-new hangs on the first process only)
// FAKE_KIRO_LOG: file; each received message is appended as one JSON line {pid, msg}
// FAKE_KIRO_SPAWN_GRANDCHILD=1: start a long-lived process in its own process group
// FAKE_KIRO_PIDS: file that gets {pid, grandchild}
// FAKE_KIRO_CHAT=1: like kiro-cli 3.5.0 for the chat route: models with effort metadata, an
//   `effortLevel` and a `thinking` option (a model change resets both), session.json on disk under
//   $HOME/.kiro/sessions, and the title sent twice in a reply
// FAKE_KIRO_NO_EFFORT=1: with FAKE_KIRO_CHAT, no `effortLevel` option (like kiro-cli 3.4)
// FAKE_KIRO_SLOW_CONFIG_MS: set_config_option answers after this delay
// Prompt text: TOOL asks a shell question and waits for the answer, WRITE asks for a file write and
//   then "Review changes" (like Autopilot off), WAIT waits for session/cancel, SLOW streams slowly,
//   TOOLOK runs a tool that completes, MCPTOOL runs an MCP tool, MAXTOKENS ends with max_tokens,
//   CRASH exits during the reply, DISPLAYERR sends a display_error and no text, MCPERR sends an
//   MCP connection display_error and no text.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_KIRO_MODE ?? 'ok';
const chat = process.env.FAKE_KIRO_CHAT === '1';
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

const CHAT_MODELS = [
  {
    value: 'auto',
    name: 'auto',
    _meta: { kiro: { rateMultiplier: 1, hasEffort: false, thinkingToggleable: false } },
  },
  {
    value: 'claude-fake-1',
    name: 'claude-fake-1',
    description: 'Claude Fake 1 model',
    _meta: {
      kiro: {
        rateMultiplier: 1.3,
        hasEffort: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffortLevel: 'medium',
        thinkingToggleable: false,
      },
    },
  },
  {
    value: 'think-fake',
    name: 'think-fake',
    _meta: { kiro: { rateMultiplier: 0.5, hasEffort: false, thinkingToggleable: true } },
  },
];
const DEFAULT_EFFORT = { 'claude-fake-1': 'medium' };

const noEffort = process.env.FAKE_KIRO_NO_EFFORT === '1';
const slowConfigMs = Number(process.env.FAKE_KIRO_SLOW_CONFIG_MS ?? '0');

const chatOptions = (s) => [
  {
    type: 'select',
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: s.model,
    options: CHAT_MODELS,
  },
  ...(noEffort
    ? []
    : [
        {
          type: 'select',
          id: 'effortLevel',
          name: 'Effort',
          category: 'thought_level',
          currentValue: s.effortLevel,
          options: ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
            value,
            name: value,
          })),
        },
      ]),
  {
    type: 'select',
    id: 'thinking',
    name: 'Thinking',
    currentValue: s.thinking,
    options: [
      { value: 'on', name: 'On' },
      { value: 'off', name: 'Off' },
    ],
  },
];

const options = (s) => [
  {
    type: 'select',
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: s.mode,
    options: [{ value: 'vibe', name: 'Default', description: 'General coding assistance' }],
  },
  ...(chat
    ? chatOptions(s)
    : [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: s.model,
          options: [
            { value: 'auto', name: 'auto', _meta: { kiro: { rateMultiplier: 1 } } },
            {
              value: 'claude-fake-1',
              name: 'claude-fake-1',
              _meta: { kiro: { rateMultiplier: 1.3 } },
            },
            { value: 'stuck-model', name: 'stuck-model' },
          ],
        },
      ]),
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
  const s = { mode: 'vibe', model: 'auto', autopilot: 'on', effortLevel: 'high', thinking: 'on' };
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

/**
 * Like Kiro: a permission question that waits for the answer. On session/cancel the question is
 * dropped at once and a late answer is ignored: the result is then `undefined`.
 */
async function askPermission(sessionId, params) {
  let answer;
  const pending = askAgent('session/request_permission', { sessionId, ...params }).then(
    (msg) => (answer = msg)
  );
  while (answer === undefined && !cancelled.has(sessionId)) {
    await Promise.race([pending, sleep(10)]);
  }
  return cancelled.has(sessionId) ? undefined : answer;
}

const optionKind = (params, answer) =>
  params.options.find((o) => o.optionId === answer?.result?.outcome?.optionId)?.kind;

const CANCELLED_TOOL = 'The tool call was cancelled before it was approved.';

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
  if (text.includes('DISPLAYERR') || text.includes('MCPERR')) {
    const mcp = text.includes('MCPERR');
    const displayError = mcp
      ? {
          message: 'MCP server "fake" failed to connect: Connection closed',
          errorType: 'mcp_connection_error',
        }
      : { message: 'You have used all your credits.', errorType: 'quota_error' };
    update(sessionId, meta('display_error', { displayError, ...displayError }));
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (mode === 'crash-on-prompt' || text.includes('CRASH')) {
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
  if (text.includes('TOOLOK') || text.includes('MCPTOOL')) {
    const mcp = text.includes('MCPTOOL');
    const toolCallId = mcp ? 'search_abc123' : 'read_file_toolu_bdrk_01FAKE';
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: mcp ? '@fake/search' : 'Read notes.txt',
      kind: 'read',
      status: 'pending',
      rawInput: mcp ? { query: 'zeros' } : 'not an object',
    });
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' });
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      rawOutput: { items: 2 },
      content: mcp
        ? undefined
        : [
            { type: 'content', content: { type: 'text', text: 'line one' } },
            { type: 'content', content: { type: 'text', text: 'line two' } },
          ],
    });
  } else if (text.includes('WRITE')) {
    const toolCallId = 'toolu_fake_write';
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Write File',
      kind: 'edit',
      status: 'pending',
      rawInput: { path: 'notes.txt' },
    });
    const write = {
      toolCall: { toolCallId, status: 'pending', title: 'Write File' },
      options: [
        { optionId: 'w1', name: 'Allow', kind: 'allow_once' },
        { optionId: 'w2', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'w3', name: 'Deny', kind: 'reject_once' },
        { optionId: 'w4', name: 'Always deny', kind: 'reject_always' },
      ],
      _meta: {
        kiro: {
          toolId: 'fs_write',
          askKind: 'tool_call_approval',
          consent: { capability: 'fs_write', resource: 'notes.txt' },
        },
      },
    };
    const first = await askPermission(sessionId, write);
    if (!first) {
      update(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'failed',
        rawOutput: { message: CANCELLED_TOOL },
      });
      return send({ id, result: { stopReason: 'cancelled' } });
    }
    let ok = optionKind(write, first)?.startsWith('allow') === true;
    if (ok) {
      const review = {
        toolCall: { toolCallId: `turn_approval_${randomUUID()}`, title: 'Review changes' },
        options: [
          { optionId: 'r1', name: 'Accept changes', kind: 'allow_once' },
          { optionId: 'r2', name: 'Reject changes', kind: 'reject_once' },
        ],
        _meta: {
          kiro: {
            type: 'turn_approval',
            askKind: 'turn_approval',
            files: [{ path: 'notes.txt', toolCallId }],
          },
        },
      };
      const second = await askPermission(sessionId, review);
      if (!second) {
        update(sessionId, {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: 'failed',
          rawOutput: { message: CANCELLED_TOOL },
        });
        return send({ id, result: { stopReason: 'cancelled' } });
      }
      ok = optionKind(review, second) === 'allow_once';
    }
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: ok ? 'completed' : 'failed',
      rawOutput: { message: ok ? 'wrote notes.txt' : 'The user rejected this tool call.' },
    });
  } else if (text.includes('TOOL')) {
    const toolCallId = `run_command_${randomUUID()}`;
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Create hello.txt',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'echo hi > hello.txt' },
    });
    const question = {
      toolCall: { toolCallId, status: 'pending', title: 'echo hi > hello.txt' },
      // The ids do not say the kind: a client must choose by kind
      options: [
        { optionId: 'o1', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'o2', name: 'Deny', kind: 'reject_once' },
        { optionId: 'o3', name: 'Allow', kind: 'allow_once' },
        { optionId: 'o4', name: 'Always deny', kind: 'reject_always' },
      ],
      _meta: {
        kiro: {
          toolId: 'run_command',
          command: 'echo hi > hello.txt',
          askKind: 'tool_call_approval',
          consent: { capability: 'shell', resource: 'echo hi > hello.txt' },
        },
      },
    };
    const answer = await askPermission(sessionId, question);
    if (!answer) {
      update(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'failed',
        rawOutput: { message: CANCELLED_TOOL },
      });
      return send({ id, result: { stopReason: 'cancelled' } });
    }
    const allowed = optionKind(question, answer)?.startsWith('allow') === true;
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
  for (let i = 0; i < (chat ? 2 : 1); i++) {
    update(sessionId, {
      sessionUpdate: 'session_info_update',
      title: 'Fake title',
      _meta: { kiro: { kind: 'focus_update', title: 'Fake title' } },
    });
  }
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
  send({ id, result: { stopReason: text.includes('MAXTOKENS') ? 'max_tokens' : 'end_turn' } });
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
    if (chat && process.env.HOME) {
      // Like Kiro: the session's folder on disk, in the bucket of its folder path
      const bucket = createHash('sha256').update(params.cwd).digest('hex').slice(0, 16);
      const dir = path.join(process.env.HOME, '.kiro', 'sessions', bucket, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'session.json'),
        JSON.stringify({ id: sessionId, title: 'New Session', workspacePaths: [params.cwd] })
      );
    }
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
    if (mode === 'load-error')
      throw { code: -32603, message: 'Internal error: session file is damaged' };
    const s = open(sessionId);
    return {
      modes: {},
      configOptions: options(s),
      _meta: { id: sessionId, title: 'Fake title', contextUsage: { usagePercentage: 3.5 } },
    };
  },
  async 'session/set_config_option'({ sessionId, configId, value }) {
    if (slowConfigMs > 0) await sleep(slowConfigMs);
    const s = sessions.get(sessionId);
    if (!s) throw { code: -32602, message: 'Session not found' };
    // Like Kiro: no validation
    if (value !== 'stuck-model') {
      s[configId] = value;
      if (chat && configId === 'model') {
        // Like Kiro: a model change resets the effort to the model's default
        s.effortLevel = DEFAULT_EFFORT[value] ?? 'high';
        s.thinking = 'on';
      }
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
