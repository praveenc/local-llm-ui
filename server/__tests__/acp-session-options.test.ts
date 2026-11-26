// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { checkOptionChange, splitSessionOptions } from '../acp/session-options.ts';
import type { ConfigOption } from '../acp/types.ts';

const select = (id: string, values: string[], extra: Partial<ConfigOption> = {}): ConfigOption => ({
  id,
  type: 'select',
  name: id,
  currentValue: values[0],
  options: values.map((value) => ({ value, name: value })),
  ...extra,
});

const OPTIONS: ConfigOption[] = [
  select('agent', ['agent-a', 'agent-b'], { category: 'mode' }),
  select('llm', ['m1', 'm2'], { category: 'model' }),
  select('level', ['low', 'high'], { category: 'thought_level' }),
  select('reasoning', ['on', 'off']),
  select('review', ['on', 'off']),
  { id: 'count', type: 'number', currentValue: 1 },
  select('memory', ['yes', 'no'], { category: 'custom' }),
];

describe('splitSessionOptions', () => {
  it('splits by ACP category and the owned ids, in the agent order', () => {
    const split = splitSessionOptions(OPTIONS, ['reasoning']);
    expect(split.mode?.id).toBe('agent');
    expect(split.owned.map((o) => o.id)).toEqual(['llm', 'level', 'reasoning']);
    // A non-select option is left out; an unknown category is a plain option
    expect(split.rest.map((o) => o.id)).toEqual(['review', 'memory']);
  });

  it('works with no owned ids and no mode', () => {
    const split = splitSessionOptions(OPTIONS.slice(1));
    expect(split.mode).toBeUndefined();
    expect(split.owned.map((o) => o.id)).toEqual(['llm', 'level']);
    expect(split.rest.map((o) => o.id)).toEqual(['reasoning', 'review', 'memory']);
  });

  it('keeps only the first mode option', () => {
    const second = select('agent2', ['x'], { category: 'mode' });
    const split = splitSessionOptions([...OPTIONS, second]);
    expect(split.mode?.id).toBe('agent');
    expect(split.rest.map((o) => o.id)).not.toContain('agent2');
  });

  it('an owned id wins over the mode category', () => {
    expect(splitSessionOptions(OPTIONS, ['agent']).mode).toBeUndefined();
  });
});

describe('checkOptionChange', () => {
  const owned = ['reasoning'];

  it('accepts a listed value of the mode and of a plain option', () => {
    expect(checkOptionChange(OPTIONS, owned, 'agent', 'agent-b')).toMatchObject({
      ok: true,
      option: { id: 'agent' },
    });
    expect(checkOptionChange(OPTIONS, owned, 'review', 'off').ok).toBe(true);
    // The current value is still a listed value
    expect(checkOptionChange(OPTIONS, owned, 'review', 'on').ok).toBe(true);
  });

  it('refuses an id that the session does not list, and a non-select option', () => {
    expect(checkOptionChange(OPTIONS, owned, 'nope', 'on')).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(checkOptionChange(OPTIONS, owned, 'count', '2')).toMatchObject({
      ok: false,
      reason: 'unknown',
    });
  });

  it('refuses an option that an app control sets, by category and by id', () => {
    for (const id of ['llm', 'level', 'reasoning']) {
      expect(checkOptionChange(OPTIONS, owned, id, 'm2')).toMatchObject({
        ok: false,
        reason: 'owned',
      });
    }
  });

  it('refuses a value that the option does not list', () => {
    expect(checkOptionChange(OPTIONS, owned, 'review', 'maybe')).toMatchObject({
      ok: false,
      reason: 'value',
      option: { id: 'review' },
    });
    expect(checkOptionChange(OPTIONS, owned, 'agent', 'agent-z')).toMatchObject({
      ok: false,
      reason: 'value',
    });
  });
});
