// A minimal ACP agent for the tests of the generic layer (server/acp). It has no product
// `_meta`, no locked options, and its own argument check (`--fake-acp`).
//
// FAKE_ACP_MODE: ok | signed-out
// FAKE_ACP_LOG: file; each received message is appended as one JSON line
// FAKE_ACP_SESSIONS=1: the agent lists and closes sessions, and session/load without `_meta`
//   replays the session: two updates before the answer and one after it
// FAKE_ACP_LOAD_SAME_WRITE=1: that update after the answer comes in the same write as the answer
// Prompt text: TOOL sends a tool_call and asks for a permission, WAIT waits for session/cancel.
import { appendFileSync } from 'node:fs';

if (process.argv.slice(2).join(' ') !== '--fake-acp') {
  process.stderr.write(`unexpected arguments: ${process.argv.slice(2).join(' ')}\n`);
  process.exit(2);
}

const mode = process.env.FAKE_ACP_MODE ?? 'ok';
const withSessions = process.env.FAKE_ACP_SESSIONS === '1';
const logFile = process.env.FAKE_ACP_LOG;
const sameWrite = process.env.FAKE_ACP_LOAD_SAME_WRITE === '1';
const encode = (msg) => `${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`;
const send = (msg) => process.stdout.write(encode(msg));
const update = (sessionId, u) =>
  send({ method: 'session/update', params: { sessionId, update: u } });
const log = (msg) => logFile && appendFileSync(logFile, `${JSON.stringify(msg)}\n`);

const OPTIONS = [
  { type: 'select', id: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
];
const waiting = new Map();
const asked = new Map();
let nextId = 1000;
let sessions = 0;

async function prompt(id, { sessionId, prompt: blocks }) {
  const text = blocks?.[0]?.text ?? '';
  update(sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hello' },
  });
  if (text === 'TOOL') {
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Write',
      kind: 'edit',
    });
    const rid = nextId++;
    const answer = new Promise((resolve) => asked.set(rid, resolve));
    send({
      id: rid,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 't1' },
        options: [
          { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
          { optionId: 'no', name: 'No', kind: 'reject_once' },
        ],
      },
    });
    const outcome = await answer;
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: outcome?.outcome?.optionId === 'yes' ? 'completed' : 'failed',
    });
  }
  if (text === 'WAIT') {
    await new Promise((resolve) => waiting.set(sessionId, resolve));
    send({ id, result: { stopReason: 'cancelled' } });
    return;
  }
  send({ id, result: { stopReason: 'end_turn' } });
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    log(msg);
    const { id, method, params } = msg;
    if (method === undefined) {
      asked.get(id)?.(msg.result);
      asked.delete(id);
    } else if (method === 'initialize') {
      send({
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            ...(withSessions && { sessionCapabilities: { list: {}, close: {} } }),
          },
          authMethods: mode === 'signed-out' ? [{ id: 'test-login' }] : [],
        },
      });
    } else if (method === 'session/new') {
      sessions += 1;
      send({ id, result: { sessionId: `s${sessions}`, configOptions: OPTIONS } });
    } else if (method === 'session/load') {
      if (withSessions && params._meta === undefined) {
        const chunk = (text) => ({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        });
        update(params.sessionId, chunk('earlier one'));
        update(params.sessionId, chunk('earlier two'));
        const answer = { id, result: { configOptions: OPTIONS, _meta: { title: 'Old' } } };
        if (sameWrite) {
          // The answer and a later update in one write: the app reads them in one chunk
          const late = {
            method: 'session/update',
            params: { sessionId: params.sessionId, update: chunk('after the answer') },
          };
          process.stdout.write([answer, late].map((m) => encode(m)).join(''));
        } else {
          send(answer);
          setTimeout(() => update(params.sessionId, chunk('after the answer')), 20);
        }
      } else {
        send({ id, result: { configOptions: OPTIONS } });
      }
    } else if (method === 'session/list' && withSessions) {
      send({
        id,
        result: {
          sessions: [
            { sessionId: 'old-1', cwd: '/tmp/fake-acp', title: 'Old', updatedAt: '2026-01-01' },
          ],
        },
      });
      send({ method: '_test/changed', params: { ids: ['old-1'] } });
    } else if (method === 'session/close' && withSessions) {
      send({ id, result: {} });
    } else if (method === 'session/prompt') {
      void prompt(id, params);
    } else if (method === 'session/cancel') {
      waiting.get(params.sessionId)?.();
      waiting.delete(params.sessionId);
    } else if (method === 'session/delete') {
      send({ id, result: {} });
    } else if (method === '_test/ping') {
      send({ id, result: { pong: true } });
    } else if (id !== undefined) {
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
