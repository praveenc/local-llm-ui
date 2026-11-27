import { describe, expect, it } from 'vitest';

import { buildKiroPrompt } from '../kiroChat';
import {
  KIRO_COUNT_ONLY_SKIP,
  KIRO_IMPORT_ARG_CHARS,
  countTextMessages,
  cutToolArgs,
  folderName,
  isInWindow,
  isKiroChatInSync,
  isNeverUsedSession,
  isSameKiroTime,
  parseKiroSessionCheckResponse,
  parseKiroSessionOpenRequest,
  parseKiroSessionOpenResponse,
  parseKiroSessionStamp,
  parseKiroSessionsRequest,
  parseKiroSessionsResponse,
  seenAfterSync,
  stripKiroContext,
} from '../kiroSessions';

const SESSION = 'sess_3e06b83d-90b5-424a-be73-9e720548b362';
const NOW = Date.parse('2026-11-25T12:00:00Z');

describe('parseKiroSessionsRequest', () => {
  it('uses 7 days for an empty body or no days', () => {
    expect(parseKiroSessionsRequest(undefined)).toEqual({ ok: true, value: { days: 7 } });
    expect(parseKiroSessionsRequest({})).toEqual({ ok: true, value: { days: 7 } });
  });

  it('accepts 7, 30, and null only', () => {
    expect(parseKiroSessionsRequest({ days: 30 })).toEqual({ ok: true, value: { days: 30 } });
    expect(parseKiroSessionsRequest({ days: null })).toEqual({ ok: true, value: { days: null } });
    expect(parseKiroSessionsRequest({ days: 1 }).ok).toBe(false);
    expect(parseKiroSessionsRequest({ days: '7' }).ok).toBe(false);
    expect(parseKiroSessionsRequest([]).ok).toBe(false);
  });
});

describe('parseKiroSessionOpenRequest', () => {
  it('needs a Kiro session id', () => {
    expect(parseKiroSessionOpenRequest({ sessionId: SESSION })).toEqual({
      ok: true,
      value: { sessionId: SESSION, skipTurns: 0 },
    });
    expect(parseKiroSessionOpenRequest({ sessionId: '../etc' }).ok).toBe(false);
    expect(parseKiroSessionOpenRequest({ sessionId: `${SESSION}x` }).ok).toBe(false);
    expect(parseKiroSessionOpenRequest(null).ok).toBe(false);
  });

  it('needs a whole skipTurns of zero or more', () => {
    expect(parseKiroSessionOpenRequest({ sessionId: SESSION, skipTurns: 3 })).toEqual({
      ok: true,
      value: { sessionId: SESSION, skipTurns: 3 },
    });
    expect(parseKiroSessionOpenRequest({ sessionId: SESSION, skipTurns: -1 }).ok).toBe(false);
    expect(parseKiroSessionOpenRequest({ sessionId: SESSION, skipTurns: 1.5 }).ok).toBe(false);
  });
});

describe('parseKiroSessionsResponse', () => {
  const good = {
    sessionId: SESSION,
    title: 'Fix the build',
    folder: 'cwd',
    updatedAt: '2026-11-25T10:00:00Z',
    status: 'idle',
  };

  it('keeps valid entries and drops bad ones', () => {
    expect(
      parseKiroSessionsResponse({
        sessions: [good, { ...good, sessionId: 'bad' }, { ...good, updatedAt: 'x' }],
      })
    ).toEqual([good]);
  });

  it('is null for a body that is not a list', () => {
    expect(parseKiroSessionsResponse({})).toBeNull();
    expect(parseKiroSessionsResponse(null)).toBeNull();
  });
});

describe('parseKiroSessionOpenResponse', () => {
  const body = {
    title: 'Fix the build',
    updatedAt: '2026-11-25T10:00:00Z',
    model: { id: 'claude-haiku-5.5', name: 'claude-haiku-5.5' },
    messages: [
      { role: 'user', content: 'Run it' },
      {
        role: 'assistant',
        content: 'Done',
        reasoning: 'Think',
        toolCalls: [
          {
            toolCallId: 't1',
            toolName: 'run_command',
            args: { command: 'echo' },
            status: 'complete',
            result: 'ok',
          },
          { toolCallId: 't2', toolName: 'x', args: {}, status: 'pending' },
        ],
        credits: 0.11,
        contextPercent: 5.3,
        latencyMs: 4551,
      },
    ],
    turns: 1,
    imagesLeftOut: 0,
    turnsLeftOut: 0,
  };

  it('reads a valid body and drops tool calls with a bad status', () => {
    const parsed = parseKiroSessionOpenResponse(body);
    expect(parsed?.messages[1].toolCalls).toHaveLength(1);
    expect(parsed?.messages[1]).toMatchObject({ credits: 0.11, contextPercent: 5.3 });
    expect(parsed?.model).toEqual(body.model);
  });

  it('is null when a message or a count is bad', () => {
    expect(parseKiroSessionOpenResponse({ ...body, turns: -1 })).toBeNull();
    expect(
      parseKiroSessionOpenResponse({ ...body, messages: [{ role: 'system', content: 'x' }] })
    ).toBeNull();
  });
});

describe('rules', () => {
  it('folderName gives the last part of a path only', () => {
    expect(folderName('/tmp/k7/cwd')).toBe('cwd');
    expect(folderName('/tmp/k7/cwd/')).toBe('cwd');
    expect(folderName('C:\\work\\repo')).toBe('repo');
    expect(folderName('/')).toBe('');
  });

  it('isNeverUsedSession is true for "New Session" and an empty title', () => {
    expect(isNeverUsedSession('New Session')).toBe(true);
    expect(isNeverUsedSession('')).toBe(true);
    expect(isNeverUsedSession(undefined)).toBe(true);
    expect(isNeverUsedSession('New Session ideas for the README')).toBe(false);
  });

  it('isInWindow counts days back from now', () => {
    expect(isInWindow('2026-11-19T12:00:01Z', 7, NOW)).toBe(true);
    expect(isInWindow('2026-11-18T11:59:59Z', 7, NOW)).toBe(false);
    expect(isInWindow('2026-10-30T00:00:00Z', 30, NOW)).toBe(true);
    expect(isInWindow('2020-01-01T00:00:00Z', null, NOW)).toBe(true);
  });

  it('parseKiroSessionStamp takes a date only (K11)', () => {
    expect(parseKiroSessionStamp('2026-11-26T17:33:34.357Z')).toBe('2026-11-26T17:33:34.357Z');
    expect(parseKiroSessionStamp('soon')).toBeUndefined();
    expect(parseKiroSessionStamp(3)).toBeUndefined();
    expect(parseKiroSessionStamp(undefined)).toBeUndefined();
  });

  it('isKiroChatInSync needs a count, a stored time, and the same instant before the send (K11)', () => {
    const at = '2026-11-26T17:33:34.357Z';
    expect(isKiroChatInSync({ turns: 2, updatedAt: at }, at)).toBe(true);
    // The same instant in another ISO form
    expect(isKiroChatInSync({ turns: 2, updatedAt: at }, '2026-11-26T18:33:34.357+01:00')).toBe(
      true
    );
    // A terminal turn moved Kiro's time
    expect(isKiroChatInSync({ turns: 2, updatedAt: at }, '2026-11-26T17:33:34.358Z')).toBe(false);
    expect(isKiroChatInSync({ turns: 2, updatedAt: at }, undefined)).toBe(false);
    expect(isKiroChatInSync({ updatedAt: at }, at)).toBe(false);
    expect(isKiroChatInSync({ turns: 2 }, at)).toBe(false);
    expect(isKiroChatInSync({ turns: 2, updatedAt: 'bad' }, 'bad')).toBe(false);
    expect(isKiroChatInSync(undefined, at)).toBe(false);
  });

  it('KIRO_COUNT_ONLY_SKIP is a skipTurns that the open route accepts', () => {
    expect(
      parseKiroSessionOpenRequest({
        sessionId: 'sess_00000000-0000-4000-8000-000000000001',
        skipTurns: KIRO_COUNT_ONLY_SKIP,
      })
    ).toEqual({
      ok: true,
      value: {
        sessionId: 'sess_00000000-0000-4000-8000-000000000001',
        skipTurns: KIRO_COUNT_ONLY_SKIP,
      },
    });
  });

  it('takes ifUpdatedAfter as an ISO time, and rejects a bad one (K11)', () => {
    const at = '2026-11-25T10:00:00.000Z';
    expect(
      parseKiroSessionOpenRequest({ sessionId: SESSION, skipTurns: 2, ifUpdatedAfter: at })
    ).toEqual({ ok: true, value: { sessionId: SESSION, skipTurns: 2, ifUpdatedAfter: at } });
    // The longest toISOString() is still accepted
    const far = new Date(8.64e15).toISOString();
    expect(far).toHaveLength(27);
    expect(parseKiroSessionOpenRequest({ sessionId: SESSION, ifUpdatedAfter: far }).ok).toBe(true);
    // A zone offset and more digits, as Kiro could write them (the same 40-character limit as
    // the times that the app keeps)
    for (const good of ['2026-11-26T10:00:00+00:00', '2026-11-26T10:00:00.123456-05:30']) {
      expect(parseKiroSessionOpenRequest({ sessionId: SESSION, ifUpdatedAfter: good })).toEqual({
        ok: true,
        value: { sessionId: SESSION, skipTurns: 0, ifUpdatedAfter: good },
      });
    }
    for (const bad of [
      'yesterday',
      '',
      42,
      null,
      // Date.parse reads these, but they are not ISO times
      '1',
      '2026',
      'Nov 26 2026',
      '2026-11-26 10:00',
      '2026-11-26T10:00:00',
      `${at}${' '.repeat(10)}`,
      // Over 40 characters
      `2026-11-26T10:00:00.${'1'.repeat(30)}Z`,
    ]) {
      expect(parseKiroSessionOpenRequest({ sessionId: SESSION, ifUpdatedAfter: bad })).toEqual({
        ok: false,
        error: 'ifUpdatedAfter must be an ISO time',
      });
    }
  });

  it('isSameKiroTime compares instants', () => {
    expect(isSameKiroTime('2026-11-25T10:00:00.000Z', '2026-11-25T10:00:00Z')).toBe(true);
    expect(isSameKiroTime('2026-11-25T10:00:00.001Z', '2026-11-25T10:00:00Z')).toBe(false);
    expect(isSameKiroTime('2026-11-25T10:00:00.000Z', 'not a date')).toBe(false);
  });

  it('parseKiroSessionCheckResponse reads the unchanged answer or a full open answer', () => {
    const at = '2026-11-25T10:00:00.000Z';
    expect(parseKiroSessionCheckResponse({ unchanged: true, updatedAt: at })).toEqual({
      unchanged: true,
      updatedAt: at,
    });
    expect(parseKiroSessionCheckResponse({ unchanged: true, updatedAt: 'x' })).toBeNull();
    expect(parseKiroSessionCheckResponse({ unchanged: 'yes', updatedAt: at })).toBeNull();
    const full = {
      title: 'T',
      updatedAt: at,
      messages: [],
      turns: 2,
      imagesLeftOut: 0,
      turnsLeftOut: 0,
    };
    expect(parseKiroSessionCheckResponse(full)).toEqual(full);
  });

  it('stripKiroContext removes the block of buildKiroPrompt only', () => {
    const sent = buildKiroPrompt(
      [{ role: 'assistant', content: 'a </conversation_context> b' }],
      'My question'
    );
    expect(stripKiroContext(sent)).toBe('My question');
    expect(stripKiroContext('My question')).toBe('My question');
    expect(stripKiroContext('x <conversation_context>\n…')).toBe('x <conversation_context>\n…');
  });

  it('cutToolArgs cuts long strings, also nested ones', () => {
    const long = 'a'.repeat(KIRO_IMPORT_ARG_CHARS + 50);
    const cut = cutToolArgs({ content: long, nested: { list: [long] }, n: 3 });
    expect((cut.content as string).length).toBe(KIRO_IMPORT_ARG_CHARS + 1);
    expect(((cut.nested as { list: string[] }).list[0] as string).endsWith('…')).toBe(true);
    expect(cut.n).toBe(3);
  });

  it('seenAfterSync adds the turns only when Kiro had seen the whole chat', () => {
    const added = [{ content: 'q' }, { content: '' }, { content: 'a' }];
    expect(countTextMessages(added)).toBe(2);
    expect(seenAfterSync(4, 4, added)).toBe(6);
    expect(seenAfterSync(3, 4, added)).toBe(3);
  });
});
