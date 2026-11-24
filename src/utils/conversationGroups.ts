/**
 * Date groups for the sidebar conversation list: Today, Yesterday, Previous 7 days,
 * Previous 30 days, then one group for each calendar month. Also the row time format and
 * the stored open state of each group. No DOM or React imports.
 */

export type RelativeGroupKey = 'today' | 'yesterday' | 'previous-7-days' | 'previous-30-days';
/** A relative group, or a month group such as 'month-2025-10' */
export type ConversationGroupKey = RelativeGroupKey | `month-${number}-${string}`;

export interface ConversationGroup<T> {
  key: ConversationGroupKey;
  label: string;
  items: T[];
}

/** Local midnight `days` days before the day of `now` (handles daylight saving changes) */
function startOfDay(now: Date, daysBack = 0): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
}

/** The group key for a chat last changed at `date` */
export function getGroupKey(date: Date, now: Date = new Date()): ConversationGroupKey {
  const time = date.getTime();
  if (time >= startOfDay(now).getTime()) return 'today';
  if (time >= startOfDay(now, 1).getTime()) return 'yesterday';
  if (time >= startOfDay(now, 7).getTime()) return 'previous-7-days';
  if (time >= startOfDay(now, 30).getTime()) return 'previous-30-days';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `month-${date.getFullYear()}-${month}`;
}

const RELATIVE_LABELS: Record<RelativeGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'previous-7-days': 'Previous 7 days',
  'previous-30-days': 'Previous 30 days',
};

/** "Today", "Previous 7 days", "October", or "October 2025" for an earlier year */
export function getGroupLabel(
  key: ConversationGroupKey,
  now: Date = new Date(),
  locale?: string
): string {
  if (key in RELATIVE_LABELS) return RELATIVE_LABELS[key as RelativeGroupKey];
  const [, year, month] = key.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: 'long' }
      : { month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/**
 * Groups items (newest first) by date. Items keep their order; groups are in the order of
 * their first item.
 */
export function groupConversations<T extends { updatedAt: Date }>(
  items: readonly T[],
  now: Date = new Date(),
  locale?: string
): ConversationGroup<T>[] {
  const groups = new Map<ConversationGroupKey, ConversationGroup<T>>();
  for (const item of items) {
    const key = getGroupKey(new Date(item.updatedAt), now);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: getGroupLabel(key, now, locale), items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

/**
 * The time at the right of a row: "14:05" (or "2:05 PM") today and yesterday, "Mon" this week,
 * else "12 Oct". The time of day uses the locale's own short format.
 */
export function formatRowTime(date: Date, key: ConversationGroupKey, locale?: string): string {
  const options: Intl.DateTimeFormatOptions =
    key === 'today' || key === 'yesterday'
      ? { timeStyle: 'short' }
      : key === 'previous-7-days'
        ? { weekday: 'short' }
        : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** The full date and time, for the row time's tooltip */
export function formatFullDateTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// Open state of each group: UI state kept in the browser, not a user preference
export const GROUP_STATE_STORAGE_KEY = 'local-llm-ui-sidebar-groups';

export type GroupOpenState = Record<string, boolean>;

const OPEN_BY_DEFAULT: ReadonlySet<string> = new Set(['today', 'yesterday', 'previous-7-days']);

/** Today, Yesterday, and Previous 7 days start open; older groups start closed */
export function isGroupOpen(state: GroupOpenState, key: string): boolean {
  return state[key] ?? OPEN_BY_DEFAULT.has(key);
}

export function loadGroupOpenState(): GroupOpenState {
  try {
    const stored = localStorage.getItem(GROUP_STATE_STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const state: GroupOpenState = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') state[key] = value;
    }
    return state;
  } catch {
    return {};
  }
}

export function saveGroupOpenState(state: GroupOpenState): void {
  try {
    localStorage.setItem(GROUP_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save the sidebar groups:', error);
  }
}
