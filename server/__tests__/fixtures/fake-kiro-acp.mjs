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
// FAKE_KIRO_USAGE: getUsage answers `full` (placeholder credits), `error` (an ACP error), or `bad`
//   (a result with no plan). Default: a plan with no credits.
// FAKE_KIRO_SLOW_CONFIG_MS: set_config_option answers after this delay
// FAKE_KIRO_LOAD_AUTOPILOT: session/load of a closed session finds this Autopilot value, as if
//   the user had changed it in the terminal while the session was closed
// FAKE_KIRO_STUCK_OPTION: set_config_option of this id answers with no change (a failed read-back)
// The `mode` option lists 3 placeholder agents; set_config_option sends config_option_update
//   after its answer (twice for `mode`, like kiro-cli 3.6.2) and, like Kiro, takes any value
// FAKE_KIRO_SESSIONS=1 (K7): session/list with used, never-used, failed, and old sessions and a
//   1 MB `customAgents` in each entry; session/load without `noReplay` of a listed session
//   replays it (updates with `replay: true` before the answer, one without after it); every
//   reply sends `_kiro/sessions/changed` (idle, with `updatedAt`) right before its result
// K11, like kiro-cli 3.6.2 (probe P1): session/list with `cwd` lists the sessions of that folder,
//   with FAKE_KIRO_CHAT from the session.json files under $HOME/.kiro/sessions. Each session's
//   `updatedAt` is kept in its session.json: it moves on each prompt and each set_config_option,
//   and not on session/load or session/close. A test simulates a terminal turn by writing a later
//   `updatedAt` into the session.json.
//   Without `cwd` (FAKE_KIRO_SESSIONS with FAKE_KIRO_CHAT), the list also has those sessions, with
//   the same `updatedAt` as the list of their folder.
// FAKE_KIRO_SLOW_LIST_MS: session/list answers after this delay (with the values at its start)
// FAKE_KIRO_LIST_ERROR=1: session/list answers an ACP error
// lease mode (K7): session/prompt answers Kiro's SessionHeldElsewhereError
// session/close answers {} and keeps the session's options for the next load, like Kiro
// Prompt text: TOOL asks a shell question and waits for the answer, WRITE asks for a file write and
//   then "Review changes" (like Autopilot off), WAIT waits for session/cancel, SLOW streams slowly,
//   TOOLOK runs a tool that completes, MCPTOOL runs an MCP tool, MAXTOKENS ends with max_tokens,
//   CRASH exits during the reply, OPTIONUPDATE sends a config_option_update (Autopilot off) during
//   the reply, DISPLAYERR sends a display_error and no text, MCPERR sends an
//   MCP connection display_error and no text.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
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
const stuckOption = process.env.FAKE_KIRO_STUCK_OPTION;
const slowListMs = Number(process.env.FAKE_KIRO_SLOW_LIST_MS ?? '0');

// --- K11: each session's `updatedAt`, in its session.json (FAKE_KIRO_CHAT) ---

const bucketOf = (cwd) => createHash('sha256').update(cwd).digest('hex').slice(0, 16);
const sessionsRoot = () => path.join(process.env.HOME ?? '', '.kiro', 'sessions');
/** The session.json of a session that session/new wrote, or undefined */
function sessionFile(sessionId) {
  if (!chat || !process.env.HOME) return undefined;
  try {
    for (const bucket of readdirSync(sessionsRoot())) {
      const file = path.join(sessionsRoot(), bucket, sessionId, 'session.json');
      if (existsSync(file)) return file;
    }
  } catch {
    // No sessions folder yet
  }
  return undefined;
}
let lastStamp = 0;
/**
 * Moves the session's `updatedAt` forward, like Kiro on a prompt or an option change. A prompt
 * also stores the session's title, as Kiro does.
 */
function touch(sessionId, title) {
  const file = sessionFile(sessionId);
  if (!file) return undefined;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (title) json.title = title;
  lastStamp = Math.max(Date.now(), lastStamp + 1, Date.parse(json.updatedAt ?? '') + 1 || 0);
  json.updatedAt = new Date(lastStamp).toISOString();
  writeFileSync(file, JSON.stringify(json));
  return json.updatedAt;
}
/** The sessions that session/new wrote, in every folder (a list without `cwd`) */
function allFolderSessions() {
  let buckets = [];
  try {
    buckets = readdirSync(sessionsRoot());
  } catch {
    return [];
  }
  const found = [];
  for (const bucket of buckets) {
    for (const sessionId of readdirSafe(path.join(sessionsRoot(), bucket))) {
      try {
        const file = path.join(sessionsRoot(), bucket, sessionId, 'session.json');
        const cwd = JSON.parse(readFileSync(file, 'utf8')).workspacePaths?.[0];
        if (typeof cwd === 'string' && bucketOf(cwd) === bucket) {
          found.push(...folderSessions(cwd).filter((e) => e.sessionId === sessionId));
        }
      } catch {
        // Not a session folder
      }
    }
  }
  return found;
}
function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
/** The sessions of one folder, from their session.json files */
function folderSessions(cwd) {
  const dir = path.join(sessionsRoot(), bucketOf(cwd));
  let ids = [];
  try {
    ids = readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const sessionId of ids) {
    try {
      const json = JSON.parse(readFileSync(path.join(dir, sessionId, 'session.json'), 'utf8'));
      if (json.id !== sessionId || json.workspacePaths?.[0] !== cwd || !json.updatedAt) continue;
      found.push({ sessionId, cwd, title: json.title ?? '', updatedAt: json.updatedAt });
    } catch {
      // Not a session folder
    }
  }
  return found;
}

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
    options: [
      { value: 'vibe', name: 'Default', description: 'General coding assistance' },
      { value: 'agent-b', name: 'Agent B', description: 'A placeholder agent' },
      { value: 'agent-c', name: 'Agent C', _meta: { kiro: { source: 'local' } } },
    ],
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

const withSessions = process.env.FAKE_KIRO_SESSIONS === '1';
const sessions = new Map();
/** Sessions that session/close released: their options come back at the next load */
const closedSessions = new Map();
let newCalls = 0;
const cancelled = new Set();
const waiters = new Map(); // agent request id -> resolve
let agentRequestId = 1000;

function open(sessionId) {
  const s = closedSessions.get(sessionId) ?? {
    mode: 'vibe',
    model: 'auto',
    autopilot: 'on',
    effortLevel: 'high',
    thinking: 'on',
  };
  if (process.env.FAKE_KIRO_LOAD_AUTOPILOT && closedSessions.has(sessionId)) {
    s.autopilot = process.env.FAKE_KIRO_LOAD_AUTOPILOT;
  }
  closedSessions.delete(sessionId);
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
  if (mode === 'lease') {
    return send({
      id,
      error: {
        code: -32000,
        message:
          'This session is loaded in another program, Fake Terminal (pid 4242), which owns its execution.  Close the session there to drive it from here.',
        data: { errorType: 'SessionHeldElsewhereError', retryErrorType: 'CLIENT_ERROR' },
      },
    });
  }
  cancelled.delete(sessionId);
  // Like Kiro: the turn moves the session's time (K11)
  touch(sessionId);
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
    // Exit only after the app has read the update: an exit can close the connection before
    // the app reads the rest of stdout. The app answers this unknown method with -32601.
    await askAgent('_fake/sync', {});
    process.exit(3);
  }
  if (text.includes('OPTIONUPDATE')) {
    // Like a change in Kiro during the reply
    s.autopilot = 'off';
    update(sessionId, { sessionUpdate: 'config_option_update', configOptions: options(s) });
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
  // Like kiro-cli 3.6.2: the turn's last entry (idle, with the session's new time) comes before
  // the prompt result
  const updatedAt = touch(sessionId, 'Fake title') ?? new Date().toISOString();
  if (withSessions) {
    notify('_kiro/sessions/changed', {
      upserted: [{ sessionId, status: 'idle', updatedAt }],
      deleted: [],
    });
  }
  send({ id, result: { stopReason: text.includes('MAXTOKENS') ? 'max_tokens' : 'end_turn' } });
}

// --- K7: session/list and the replay of session/load ---

// One start time: the same session has the same `updatedAt` in every list, as in Kiro
const listedAt = Date.now();
const hoursAgo = (h) => new Date(listedAt - h * 3_600_000).toISOString();
const LISTED = {
  used: 'sess_11111111-1111-4111-8111-111111111111',
  never: 'sess_22222222-2222-4222-8222-222222222222',
  failed: 'sess_33333333-3333-4333-8333-333333333333',
  older: 'sess_44444444-4444-4444-8444-444444444444',
  oldest: 'sess_55555555-5555-4555-8555-555555555555',
};
const customAgents = [{ id: 'big-agent', prompt: 'x'.repeat(1024 * 1024) }];
const listEntry = (sessionId, cwd, title, hours, status = 'idle') => ({
  sessionId,
  cwd,
  title,
  updatedAt: hoursAgo(hours),
  _meta: { kiro: { status, source: 'local', executionTarget: { kind: 'local' }, customAgents } },
});

function listSessions() {
  return {
    sessions: [
      listEntry(LISTED.older, '/work/older-project', 'Ten days ago', 240),
      listEntry(LISTED.used, '/work/fake-project/', 'Fix the fake test', 1),
      listEntry(LISTED.never, '/work/fake-project', 'New Session', 0.5),
      listEntry(LISTED.failed, '/work/other', 'It failed', 2, 'failed'),
      listEntry(LISTED.oldest, '/work/oldest', 'Forty days ago', 960),
      listEntry('not-a-session-id', '/work/bad', 'Bad id', 1),
    ],
  };
}

/** Two turns, like Kiro 3.6 replays them (text replaced) */
function replay(sessionId) {
  const r = (u) => update(sessionId, { ...u, _meta: { kiro: { ...u._meta?.kiro, replay: true } } });
  const info = (kind, extra) =>
    r({ sessionUpdate: 'session_info_update', _meta: { kiro: { kind, ...extra } } });
  const user = (messageId, content) =>
    r({ sessionUpdate: 'user_message_chunk', content, _meta: { kiro: { messageId } } });
  const toolCallId = 'run_command_toolu_bdrk_01REPLAY';
  // Like a load of a session whose values changed: a config_option_update before the answer, newer
  // than the options in the answer (agent B, Autopilot off)
  update(sessionId, {
    sessionUpdate: 'config_option_update',
    configOptions: options({ mode: 'agent-b', model: 'claude-fake-1', autopilot: 'off' }),
  });
  // Turn 1: a prompt from the app with its context block, a tool call, and an image
  user('m1', {
    type: 'text',
    text: '<conversation_context>\n<message role="user">\nolder\n</message>\n</conversation_context>\n\n',
  });
  user('m1', { type: 'text', text: 'Run the command' });
  user('m1', { type: 'image', data: 'AAAA', mimeType: 'image/png' });
  info('turn_start', { turnId: 't1' });
  r({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'I will run it' } });
  r({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'Run echo',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'echo k7', note: 'n'.repeat(3000) },
  });
  info('pending_interaction', { toolCallId, interactionType: 'tool_approval' });
  info('interaction_resolved', { toolCallId, outcome: 'selected' });
  r({
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    rawOutput: 'o'.repeat(9000),
    content: [{ type: 'content', content: { type: 'text', text: 'o'.repeat(9000) } }],
  });
  r({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done: ' } });
  r({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'k7' } });
  info('context_usage', { usagePercentage: 5.5, contextUsage: { usagePercentage: 5.5 } });
  info('turn_completion', {
    promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: 0.12 }],
    elapsedTime: 4500,
    status: 'success',
  });
  info('turn_end', { stopReason: 'end_turn' });
  // Turn 2: a plain reply, and a tool call that never got a result
  user('m2', { type: 'text', text: 'Say hi' });
  info('turn_start', { turnId: 't2' });
  r({
    sessionUpdate: 'tool_call',
    toolCallId: 'read_toolu_bdrk_01LOST',
    title: 'Read',
    kind: 'read',
  });
  r({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } });
  info('context_usage', { usagePercentage: 6.25 });
  info('turn_completion', {
    promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: 0.03 }],
    elapsedTime: 900,
  });
  info('turn_end', { stopReason: 'end_turn' });
  info('session_usage', { credits: [{ usage: 0.15, unit: 'credit', unitPlural: 'credits' }] });
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
      const dir = path.join(sessionsRoot(), bucketOf(params.cwd), sessionId);
      mkdirSync(dir, { recursive: true });
      lastStamp = Math.max(Date.now(), lastStamp + 1);
      writeFileSync(
        path.join(dir, 'session.json'),
        JSON.stringify({
          id: sessionId,
          title: 'New Session',
          workspacePaths: [params.cwd],
          updatedAt: new Date(lastStamp).toISOString(),
        })
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
  'session/load'({ sessionId, _meta }) {
    if (mode === 'load-error')
      throw { code: -32603, message: 'Internal error: session file is damaged' };
    if (withSessions && !_meta?.kiro?.noReplay && Object.values(LISTED).includes(sessionId)) {
      replay(sessionId);
      // Like Kiro: an update after the answer, without `replay: true`
      setTimeout(
        () =>
          update(sessionId, {
            sessionUpdate: 'session_info_update',
            _meta: { kiro: { kind: 'context_usage', usagePercentage: 99 } },
          }),
        0
      );
      return {
        modes: {},
        configOptions: options({ mode: 'vibe', model: 'claude-fake-1', autopilot: 'on' }),
        _meta: { id: sessionId, title: 'Replayed title', contextUsage: { usagePercentage: 6.25 } },
      };
    }
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
    if (value !== 'stuck-model' && configId !== stuckOption) {
      s[configId] = value;
      // Like Kiro: an option change moves the session's time (K11, P1)
      touch(sessionId);
      if (chat && configId === 'model') {
        // Like Kiro: a model change resets the effort to the model's default
        s.effortLevel = DEFAULT_EFFORT[value] ?? 'high';
        s.thinking = 'on';
      }
    }
    // Like Kiro: config_option_update after the answer, twice for an agent change
    setTimeout(() => {
      for (let i = 0; i < (configId === 'mode' ? 2 : 1); i += 1) {
        update(sessionId, { sessionUpdate: 'config_option_update', configOptions: options(s) });
      }
    }, 0);
    return { configOptions: options(s) };
  },
  '_kiro/account/getUsage'() {
    const usage = process.env.FAKE_KIRO_USAGE;
    if (usage === 'error') throw { code: -32603, message: 'Internal error: usage unavailable' };
    if (usage === 'bad') return { success: false, message: 'no plan' };
    if (usage === 'full') {
      return {
        success: true,
        message: 'Plan: KIRO POWER | 1 usage breakdowns',
        data: {
          planName: 'KIRO POWER',
          billingCycleReset: '2026-12-01',
          overagesEnabled: true,
          overageCapable: true,
          isEnterprise: false,
          usageBreakdowns: [
            {
              resourceType: 'CREDIT',
              displayName: 'Credits',
              used: 1250.5,
              limit: 10000,
              percentage: 12,
              currentOverages: 0,
              overageRate: 0.04,
              overageCharges: 0,
              currency: 'USD',
              hasLimit: true,
            },
          ],
          bonusCredits: [],
          addOnCredits: [],
        },
      };
    }
    return { success: true, data: { planName: 'FAKE', usageBreakdowns: [] } };
  },
  async 'session/list'(params) {
    if (process.env.FAKE_KIRO_LIST_ERROR === '1') {
      throw { code: -32603, message: 'Internal error: list failed' };
    }
    if (typeof params?.cwd === 'string' && (chat || withSessions)) {
      // K11: the sessions of one folder, with the values at the start of the call
      const all = withSessions ? listSessions().sessions : [];
      const result = {
        sessions: [
          ...all.filter((e) => e.cwd === params.cwd),
          ...(chat ? folderSessions(params.cwd) : []),
        ],
      };
      if (slowListMs > 0) await sleep(slowListMs);
      return result;
    }
    if (!withSessions) throw { code: -32601, message: 'Method not found' };
    // K11: with FAKE_KIRO_CHAT, also the sessions that session/new wrote, with the same values as
    // the list of their folder
    const result = {
      sessions: [...listSessions().sessions, ...(chat ? allFolderSessions() : [])],
    };
    if (slowListMs > 0) await sleep(slowListMs);
    return result;
  },
  'session/close'({ sessionId }) {
    const s = sessions.get(sessionId);
    if (s) closedSessions.set(sessionId, s);
    sessions.delete(sessionId);
    return {};
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
