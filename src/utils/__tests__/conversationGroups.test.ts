import { afterEach, describe, expect, it } from 'vitest';

import {
  GROUP_STATE_STORAGE_KEY,
  formatRowTime,
  getGroupKey,
  getGroupLabel,
  groupConversations,
  isGroupOpen,
  loadGroupOpenState,
  saveGroupOpenState,
} from '../conversationGroups';

// Tuesday 24 November 2026, 16:30 local time
const now = new Date(2026, 10, 24, 16, 30);
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('getGroupKey', () => {
  it('puts a chat from after local midnight in Today', () => {
    expect(getGroupKey(at(2026, 11, 24, 0, 0), now)).toBe('today');
    expect(getGroupKey(at(2026, 11, 24, 16, 29), now)).toBe('today');
  });

  it('puts a chat from the day before in Yesterday', () => {
    expect(getGroupKey(at(2026, 11, 23, 23, 59), now)).toBe('yesterday');
    expect(getGroupKey(at(2026, 11, 23, 0, 0), now)).toBe('yesterday');
  });

  it('uses Previous 7 days up to midnight 7 days ago', () => {
    expect(getGroupKey(at(2026, 11, 22, 23, 0), now)).toBe('previous-7-days');
    expect(getGroupKey(at(2026, 11, 17, 0, 0), now)).toBe('previous-7-days');
    expect(getGroupKey(at(2026, 11, 16, 23, 59), now)).toBe('previous-30-days');
  });

  it('uses Previous 30 days up to midnight 30 days ago', () => {
    expect(getGroupKey(at(2026, 10, 25, 0, 0), now)).toBe('previous-30-days');
    expect(getGroupKey(at(2026, 10, 24, 23, 59), now)).toBe('month-2026-10');
  });

  it('groups older chats by calendar month', () => {
    expect(getGroupKey(at(2026, 9, 3), now)).toBe('month-2026-09');
    expect(getGroupKey(at(2025, 10, 12), now)).toBe('month-2025-10');
  });
});

describe('getGroupLabel', () => {
  it('uses sentence case for the relative groups', () => {
    expect(getGroupLabel('today', now)).toBe('Today');
    expect(getGroupLabel('yesterday', now)).toBe('Yesterday');
    expect(getGroupLabel('previous-7-days', now)).toBe('Previous 7 days');
    expect(getGroupLabel('previous-30-days', now)).toBe('Previous 30 days');
  });

  it('names a month of this year without the year', () => {
    expect(getGroupLabel('month-2026-10', now, 'en-GB')).toBe('October');
  });

  it('adds the year for an earlier year', () => {
    expect(getGroupLabel('month-2025-10', now, 'en-GB')).toBe('October 2025');
  });
});

describe('groupConversations', () => {
  it('keeps the input order and orders groups by their first item', () => {
    const items = [
      { id: 'a', updatedAt: at(2026, 11, 24, 14, 5) },
      { id: 'b', updatedAt: at(2026, 11, 24, 9, 12) },
      { id: 'c', updatedAt: at(2026, 11, 23, 18, 40) },
      { id: 'd', updatedAt: at(2026, 11, 20) },
      { id: 'e', updatedAt: at(2026, 11, 1) },
      { id: 'f', updatedAt: at(2026, 10, 20) },
      { id: 'g', updatedAt: at(2026, 10, 2) },
      { id: 'h', updatedAt: at(2025, 10, 12) },
    ];
    const groups = groupConversations(items, now, 'en-GB');
    expect(groups.map((g) => [g.key, g.label, g.items.map((i) => i.id).join('')])).toEqual([
      ['today', 'Today', 'ab'],
      ['yesterday', 'Yesterday', 'c'],
      ['previous-7-days', 'Previous 7 days', 'd'],
      ['previous-30-days', 'Previous 30 days', 'e'],
      ['month-2026-10', 'October', 'fg'],
      ['month-2025-10', 'October 2025', 'h'],
    ]);
  });

  it('returns no groups for no items', () => {
    expect(groupConversations([], now)).toEqual([]);
  });
});

describe('formatRowTime', () => {
  it('shows the time of day in Today and Yesterday', () => {
    expect(formatRowTime(at(2026, 11, 24, 14, 5), 'today', 'en-GB')).toBe('14:05');
    expect(formatRowTime(at(2026, 11, 23, 9, 7), 'yesterday', 'en-GB')).toBe('09:07');
  });

  it('uses the short time of the locale, without a leading zero in 12-hour locales', () => {
    expect(formatRowTime(at(2026, 11, 24, 15, 5), 'today', 'en-US')).toBe('3:05 PM');
  });

  it('shows the short weekday in Previous 7 days', () => {
    expect(formatRowTime(at(2026, 11, 23), 'previous-7-days', 'en-GB')).toBe('Mon');
  });

  it('shows the day and short month in older groups', () => {
    expect(formatRowTime(at(2026, 10, 12), 'month-2026-10', 'en-GB')).toBe('12 Oct');
    expect(formatRowTime(at(2026, 11, 2), 'previous-30-days', 'en-GB')).toBe('2 Nov');
  });
});

describe('group open state', () => {
  afterEach(() => localStorage.clear());

  it('opens Today, Yesterday, and Previous 7 days by default', () => {
    expect(isGroupOpen({}, 'today')).toBe(true);
    expect(isGroupOpen({}, 'yesterday')).toBe(true);
    expect(isGroupOpen({}, 'previous-7-days')).toBe(true);
    expect(isGroupOpen({}, 'previous-30-days')).toBe(false);
    expect(isGroupOpen({}, 'month-2026-10')).toBe(false);
  });

  it('uses the stored value over the default', () => {
    expect(isGroupOpen({ today: false, 'month-2026-10': true }, 'today')).toBe(false);
    expect(isGroupOpen({ today: false, 'month-2026-10': true }, 'month-2026-10')).toBe(true);
  });

  it('saves and loads the state', () => {
    saveGroupOpenState({ yesterday: false, 'previous-30-days': true });
    expect(JSON.parse(localStorage.getItem(GROUP_STATE_STORAGE_KEY) ?? '')).toEqual({
      yesterday: false,
      'previous-30-days': true,
    });
    expect(loadGroupOpenState()).toEqual({ yesterday: false, 'previous-30-days': true });
  });

  it('loads an empty state when nothing or something broken is stored', () => {
    expect(loadGroupOpenState()).toEqual({});
    localStorage.setItem(GROUP_STATE_STORAGE_KEY, '{not json');
    expect(loadGroupOpenState()).toEqual({});
    localStorage.setItem(GROUP_STATE_STORAGE_KEY, '[true]');
    expect(loadGroupOpenState()).toEqual({});
    localStorage.setItem(GROUP_STATE_STORAGE_KEY, '{"today":"yes","yesterday":false}');
    expect(loadGroupOpenState()).toEqual({ yesterday: false });
  });
});
