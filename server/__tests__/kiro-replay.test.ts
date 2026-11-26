// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LoadSessionResult, SessionUpdate } from '../acp/types.ts';
import {
  KIRO_REPLAY_NO_RESULT,
  createKiroReplayCollector,
  kiroReplayModel,
} from '../kiro/replay.ts';

const replayed = (update: SessionUpdate): SessionUpdate => {
  const meta = (update._meta as { kiro?: Record<string, unknown> } | undefined)?.kiro ?? {};
  return { ...update, _meta: { kiro: { ...meta, replay: true } } };
};
const user = (messageId: string | undefined, content: Record<string, unknown>) =>
  replayed({ sessionUpdate: 'user_message_chunk', content, _meta: { kiro: { messageId } } });
const text = (t: string) => ({ type: 'text', text: t });
const info = (kind: string, extra: Record<string, unknown> = {}) =>
  replayed({ sessionUpdate: 'session_info_update', _meta: { kiro: { kind, ...extra } } });
const say = (t: string) => replayed({ sessionUpdate: 'agent_message_chunk', content: text(t) });
const think = (t: string) => replayed({ sessionUpdate: 'agent_thought_chunk', content: text(t) });
const credits = (usage: number, elapsedTime: number) =>
  info('turn_completion', {
    promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage }],
    elapsedTime,
  });

const LOAD: LoadSessionResult = {
  configOptions: [
    {
      id: 'model',
      type: 'select',
      currentValue: 'claude-fake-1',
      options: [{ value: 'claude-fake-1', name: 'Claude Fake 1' }],
    },
  ],
};

/** Turn 1: context block, image, thinking, a long tool call; turn 2: a lost tool call */
function twoTurns(): SessionUpdate[] {
  const toolCallId = 'run_command_toolu_bdrk_01A';
  return [
    user(
      'm1',
      text(
        '<conversation_context>\n<message role="user">\nold\n</message>\n</conversation_context>\n\n'
      )
    ),
    user('m1', text('Run it')),
    user('m1', { type: 'image', data: 'AA', mimeType: 'image/png' }),
    info('turn_start'),
    think('thinking'),
    replayed({
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Run',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'echo k7', note: 'n'.repeat(2500) },
    }),
    info('pending_interaction', { toolCallId }),
    info('interaction_resolved', { toolCallId }),
    replayed({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      rawOutput: 'o'.repeat(9000),
    }),
    say('Done: '),
    say('k7'),
    info('context_usage', { usagePercentage: 5.5 }),
    credits(0.12, 4500),
    info('turn_end'),
    user('m2', text('Say hi')),
    info('turn_start'),
    replayed({ sessionUpdate: 'tool_call', toolCallId: 'read_toolu_bdrk_01B', kind: 'read' }),
    say('hi'),
    info('context_usage', { usagePercentage: 6.25 }),
    credits(0.03, 900),
    info('turn_end'),
    info('session_usage', { credits: [{ unit: 'credit', usage: 0.15 }] }),
  ];
}

function run(updates: SessionUpdate[], skipTurns = 0, maxBytes?: number) {
  const collector = createKiroReplayCollector(skipTurns);
  for (const update of updates) collector.onUpdate(update);
  return collector.finish(LOAD, maxBytes);
}

describe('createKiroReplayCollector', () => {
  it('maps each turn to a user and an assistant message', () => {
    const result = run(twoTurns());
    expect(result.turns).toBe(2);
    expect(result.imagesLeftOut).toBe(1);
    expect(result.turnsLeftOut).toBe(0);
    expect(result.model).toEqual({ id: 'claude-fake-1', name: 'Claude Fake 1' });
    const [u1, a1, u2, a2] = result.messages;
    expect(result.messages).toHaveLength(4);
    // The app's context block is not the user's text
    expect(u1).toEqual({ role: 'user', content: 'Run it' });
    expect(a1).toMatchObject({
      role: 'assistant',
      content: 'Done: k7',
      reasoning: 'thinking',
      credits: 0.12,
      contextPercent: 5.5,
      latencyMs: 4500,
    });
    const tool = a1.toolCalls![0];
    expect(tool).toMatchObject({
      toolCallId: 'run_command_toolu_bdrk_01A',
      toolName: 'run_command',
      status: 'complete',
    });
    // Output cut to 8,000 characters and each argument string to 2,000, as stored replies are
    expect(tool.result).toBe(`${'o'.repeat(8000)}…`);
    expect(tool.args).toEqual({ command: 'echo k7', note: `${'n'.repeat(2000)}…` });
    expect(u2).toEqual({ role: 'user', content: 'Say hi' });
    expect(a2).toMatchObject({ content: 'hi', credits: 0.03, contextPercent: 6.25 });
    // A tool call with no result at the end of the replay failed
    expect(a2.toolCalls).toEqual([
      {
        toolCallId: 'read_toolu_bdrk_01B',
        toolName: 'read',
        args: {},
        status: 'error',
        result: KIRO_REPLAY_NO_RESULT,
      },
    ]);
  });

  it('skips updates that are not replayed', () => {
    const late = { sessionUpdate: 'agent_message_chunk', content: text(' late') } as SessionUpdate;
    const result = run([
      ...twoTurns(),
      late,
      { ...info('context_usage'), _meta: { kiro: { kind: 'context_usage', usagePercentage: 99 } } },
    ]);
    expect(result.messages[3]).toMatchObject({ content: 'hi', contextPercent: 6.25 });
  });

  it('returns only the turns after skipTurns, and counts all of them', () => {
    const result = run(twoTurns(), 1);
    expect(result.turns).toBe(2);
    expect(result.messages.map((m) => m.content)).toEqual(['Say hi', 'hi']);
    expect(result.imagesLeftOut).toBe(0);
  });

  it('leaves out the oldest turns that do not fit the size cap', () => {
    const result = run(twoTurns(), 0, 64 * 1024 + 2_000);
    expect(result.turnsLeftOut).toBe(1);
    expect(result.messages.map((m) => m.content)).toEqual(['Say hi', 'hi']);
    // The image of the turn that was left out is not counted
    expect(result.imagesLeftOut).toBe(0);
    expect(run(twoTurns(), 0, 1).messages).toEqual([]);
  });

  it('starts a turn at a turn_start when the turn has started already', () => {
    const result = run([
      info('turn_start'),
      say('first'),
      info('turn_end'),
      info('turn_start'),
      say('second'),
      info('turn_end'),
    ]);
    expect(result.turns).toBe(2);
    expect(result.messages.map((m) => m.content)).toEqual(['', 'first', '', 'second']);
  });

  it('keeps user chunks without a messageId in one turn', () => {
    const result = run([user(undefined, text('a')), user(undefined, text('b')), say('c')]);
    expect(result.messages.map((m) => m.content)).toEqual(['ab', 'c']);
  });

  it('leaves out a last turn that Kiro has not ended, and does not count it', () => {
    const running = [
      ...twoTurns(),
      user('m3', text('Still going')),
      info('turn_start'),
      say('par'),
    ];
    const result = run(running);
    expect(result.turns).toBe(2);
    expect(result.messages.map((m) => m.content)).toEqual(['Run it', 'Done: k7', 'Say hi', 'hi']);
    // Only the user message so far: the turn runs too
    expect(run([...twoTurns(), user('m3', text('Next'))]).turns).toBe(2);
    // A sync after it sees nothing new until the turn ends
    expect(run(running, 2).messages).toEqual([]);
  });

  it("shows Kiro's error for a reply with no text", () => {
    const result = run([
      user('m1', text('hello')),
      info('turn_start'),
      info('display_error', { message: 'You have used all your credits.', errorType: 'quota' }),
      info('turn_end'),
    ]);
    expect(result.messages[1].content).toBe('_You have used all your credits._');
  });
});

describe('kiroReplayModel', () => {
  it('reads the model option, with its id as the name when it has none', () => {
    expect(kiroReplayModel(undefined)).toBeUndefined();
    expect(
      kiroReplayModel([{ id: 'model', type: 'select', currentValue: 'auto', options: [] }])
    ).toEqual({ id: 'auto', name: 'auto' });
  });
});
