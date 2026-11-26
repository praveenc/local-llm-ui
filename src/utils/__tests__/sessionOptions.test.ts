import { describe, expect, it } from 'vitest';

import { parseKiroChatRequest } from '../kiroChat';
import { parseKiroSessionOpenResponse } from '../kiroSessions';
import {
  MAX_SESSION_OPTION_CHARS,
  MAX_SESSION_OPTION_ENTRIES,
  MAX_SESSION_OPTION_NAME_CHARS,
  compactSessionOption,
  currentValueName,
  defaultModeValues,
  listedValues,
  parseSessionOptionsRequest,
  parseSessionOptionsSnapshot,
  processWideOptionIds,
  sessionOptionsToSend,
  snapshotValues,
  withValues,
} from '../sessionOptions';
import type { SessionOptionsSnapshot } from '../sessionOptions';

const rawMode = {
  type: 'select',
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  currentValue: 'agent-a',
  options: [
    { value: 'agent-a', name: 'Agent A', description: 'The default agent', _meta: { x: 1 } },
    { value: 'agent-b', name: 'Agent B' },
  ],
  _meta: { secret: true },
};
const rawSwitch = {
  type: 'select',
  id: 'switch',
  name: 'Switch',
  currentValue: 'on',
  options: [
    { value: 'on', name: 'On', description: 'Does the thing' },
    { value: 'off', name: 'Off' },
  ],
};

const snapshot: SessionOptionsSnapshot = {
  mode: compactSessionOption(rawMode)!,
  options: [compactSessionOption(rawSwitch)!],
};

describe('parseSessionOptionsRequest', () => {
  it('keeps string entries', () => {
    expect(parseSessionOptionsRequest({ mode: 'agent-b', switch: 'off' })).toEqual({
      mode: 'agent-b',
      switch: 'off',
    });
  });

  it('drops bad entries instead of failing', () => {
    const long = 'x'.repeat(MAX_SESSION_OPTION_CHARS + 1);
    expect(
      parseSessionOptionsRequest({
        ok: 'v',
        num: 1,
        empty: '',
        [long]: 'v',
        longValue: long,
        ctl: 'a\nb',
        constructor: 'v',
      })
    ).toEqual({ ok: 'v' });
    expect(parseSessionOptionsRequest(JSON.parse('{"__proto__":"v","a":"b"}'))).toEqual({
      a: 'b',
    });
  });

  it('keeps at most the entry limit', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_SESSION_OPTION_ENTRIES + 5 }, (_, i) => [`id${i}`, 'v'])
    );
    expect(Object.keys(parseSessionOptionsRequest(many)!)).toHaveLength(MAX_SESSION_OPTION_ENTRIES);
  });

  it('is undefined for nothing usable', () => {
    expect(parseSessionOptionsRequest(undefined)).toBeUndefined();
    expect(parseSessionOptionsRequest(['a'])).toBeUndefined();
    expect(parseSessionOptionsRequest({ a: 1 })).toBeUndefined();
  });

  it('goes into the chat request, and a bad value does not fail it', () => {
    const base = { seenMessages: 0, history: [], prompt: 'Hi', model: 'claude-haiku-5.5' };
    const ok = parseKiroChatRequest({ ...base, sessionOptions: { switch: 'off', bad: 2 } });
    expect(ok).toEqual({ ok: true, value: { ...base, sessionOptions: { switch: 'off' } } });
    expect(parseKiroChatRequest({ ...base, sessionOptions: 'x' })).toEqual({
      ok: true,
      value: base,
    });
  });
});

describe('compactSessionOption', () => {
  it('drops _meta and keeps the agent names', () => {
    expect(snapshot.mode).toEqual({
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      currentValue: 'agent-a',
      values: [
        { value: 'agent-a', name: 'Agent A', description: 'The default agent' },
        { value: 'agent-b', name: 'Agent B' },
      ],
    });
  });

  it('uses the id or value when the agent gives no name, and cuts long names', () => {
    const option = compactSessionOption({
      type: 'select',
      id: 'x',
      currentValue: 'a',
      options: [{ value: 'a' }, { value: 'b', name: 'n'.repeat(500) }],
    })!;
    expect(option.name).toBe('x');
    expect(option.values[0].name).toBe('a');
    expect(option.values[1].name).toHaveLength(MAX_SESSION_OPTION_NAME_CHARS);
  });

  it('is undefined for a non-select or an option without usable values', () => {
    expect(compactSessionOption({ ...rawSwitch, type: 'boolean' })).toBeUndefined();
    expect(compactSessionOption({ ...rawSwitch, currentValue: true })).toBeUndefined();
    expect(compactSessionOption({ ...rawSwitch, options: [{ value: 3 }] })).toBeUndefined();
  });
});

describe('parseSessionOptionsSnapshot', () => {
  it('accepts its own output', () => {
    expect(parseSessionOptionsSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseSessionOptionsSnapshot({ options: [] })).toEqual({ options: [] });
  });

  it('rejects a bad snapshot', () => {
    expect(parseSessionOptionsSnapshot(null)).toBeNull();
    expect(parseSessionOptionsSnapshot({ options: [{ id: 'x' }] })).toBeNull();
    expect(parseSessionOptionsSnapshot({ mode: 3, options: [] })).toBeNull();
  });

  it('is in the sessions/open response, and a bad one is left out', () => {
    const base = {
      title: 'T',
      updatedAt: '2026-11-01T00:00:00.000Z',
      messages: [],
      turns: 0,
      imagesLeftOut: 0,
      turnsLeftOut: 0,
    };
    expect(parseKiroSessionOpenResponse({ ...base, sessionOptions: snapshot })).toEqual({
      ...base,
      sessionOptions: snapshot,
    });
    expect(parseKiroSessionOpenResponse({ ...base, sessionOptions: 'bad' })).toEqual(base);
  });
});

describe('values', () => {
  it('snapshotValues has mode and the others', () => {
    expect(snapshotValues(snapshot)).toEqual({ mode: 'agent-a', switch: 'on' });
  });

  it('withValues layers stored values and picks', () => {
    const shown = withValues(snapshot, { switch: 'off' }, { mode: 'agent-b' });
    expect(shown.mode?.currentValue).toBe('agent-b');
    expect(shown.options[0].currentValue).toBe('off');
    expect(currentValueName(shown.mode!)).toBe('Agent B');
    expect(currentValueName({ ...shown.options[0], currentValue: 'gone' })).toBe('gone');
  });
});

describe('sessionOptionsToSend', () => {
  it('sends only changed picks for the same session', () => {
    expect(
      sessionOptionsToSend({
        stored: { mode: 'agent-a', switch: 'off' },
        pending: { mode: 'agent-b', switch: 'off' },
        newSession: false,
      })
    ).toEqual({ mode: 'agent-b' });
    expect(sessionOptionsToSend({ stored: { switch: 'off' }, newSession: false })).toBeUndefined();
  });

  it('carries the stored values and the picks to a new session', () => {
    expect(
      sessionOptionsToSend({
        stored: { mode: 'agent-a', switch: 'off' },
        pending: { mode: 'agent-b' },
        newSession: true,
      })
    ).toEqual({ mode: 'agent-b', switch: 'off' });
    expect(sessionOptionsToSend({ newSession: true })).toBeUndefined();
  });

  it('never replays a stored value of a process-wide option to a new session', () => {
    expect(
      sessionOptionsToSend({
        stored: { mode: 'agent-a', contentCollection: 'disabled' },
        newSession: true,
        processWide: ['contentCollection'],
      })
    ).toEqual({ mode: 'agent-a' });
    expect(
      sessionOptionsToSend({
        stored: { contentCollection: 'disabled' },
        newSession: true,
        processWide: ['contentCollection'],
      })
    ).toBeUndefined();
  });

  it('still sends a pick of a process-wide option, to a new and to the same session', () => {
    const input = {
      stored: { contentCollection: 'enabled' },
      pending: { contentCollection: 'disabled' },
      processWide: ['contentCollection'],
    };
    expect(sessionOptionsToSend({ ...input, newSession: true })).toEqual({
      contentCollection: 'disabled',
    });
    expect(sessionOptionsToSend({ ...input, newSession: false })).toEqual({
      contentCollection: 'disabled',
    });
  });
});

describe('option scope (process-wide options)', () => {
  const scoped = {
    options: [
      { ...snapshot.options[0], id: 'contentCollection', scope: 'process' },
      snapshot.options[0],
    ],
  };

  it('keeps scope process, and reads a missing or unknown scope as per session', () => {
    const parsed = parseSessionOptionsSnapshot(JSON.parse(JSON.stringify(scoped)));
    expect(parsed?.options[0].scope).toBe('process');
    expect(parsed?.options[1]).not.toHaveProperty('scope');
    // An older server: no scope at all
    expect(parseSessionOptionsSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const unknown = parseSessionOptionsSnapshot({
      options: [{ ...snapshot.options[0], scope: 'account' }],
    });
    expect(unknown?.options[0]).not.toHaveProperty('scope');
  });

  it('processWideOptionIds lists the marked options', () => {
    expect(processWideOptionIds(parseSessionOptionsSnapshot(scoped))).toEqual([
      'contentCollection',
    ]);
    expect(processWideOptionIds(snapshot)).toEqual([]);
    expect(processWideOptionIds(null)).toEqual([]);
  });
});

describe('defaultModeValues', () => {
  const snapshot: SessionOptionsSnapshot = {
    mode: {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      currentValue: 'agent-a',
      values: [
        { value: 'agent-a', name: 'Agent A' },
        { value: 'agent-b', name: 'Agent B' },
      ],
    },
    options: [],
  };

  it('gives the listed agent as the mode value', () => {
    expect(defaultModeValues(snapshot, 'agent-b')).toEqual({
      values: { mode: 'agent-b' },
      missing: false,
    });
  });

  it('says when the agent is no longer listed', () => {
    expect(defaultModeValues(snapshot, 'agent-gone')).toEqual({ missing: true });
  });

  it('gives nothing without an id or a list', () => {
    expect(defaultModeValues(snapshot, undefined)).toEqual({ missing: false });
    expect(defaultModeValues(null, 'agent-b')).toEqual({ missing: false });
    expect(defaultModeValues({ options: [] }, 'agent-b')).toEqual({ missing: false });
  });
});

describe('listedValues (D27)', () => {
  const lists: SessionOptionsSnapshot = {
    mode: {
      id: 'mode',
      name: 'Mode',
      currentValue: 'agent-a',
      values: [
        { value: 'agent-a', name: 'Agent A' },
        { value: 'agent-b', name: 'Agent B' },
      ],
    },
    options: [
      {
        id: 'autopilot',
        name: 'Autopilot',
        currentValue: 'on',
        values: [
          { value: 'on', name: 'Autopilot' },
          { value: 'off', name: 'Supervised' },
        ],
      },
    ],
  };

  it('keeps only the values that the lists have', () => {
    expect(listedValues(lists, { mode: 'agent-b', autopilot: 'gone', other: 'x' })).toEqual({
      mode: 'agent-b',
    });
    expect(listedValues(lists, { autopilot: 'off' })).toEqual({ autopilot: 'off' });
  });

  it('is undefined when nothing is left', () => {
    expect(listedValues(lists, { mode: 'agent-gone' })).toBeUndefined();
    expect(listedValues(lists, undefined)).toBeUndefined();
    expect(listedValues({ options: [] }, { mode: 'agent-a' })).toBeUndefined();
  });
});
