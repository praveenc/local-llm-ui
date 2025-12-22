/**
 * Date utility functions for conversation grouping
 */

export type DateGroup = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

export const DATE_GROUP_LABELS: Record<DateGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
};

// Order for rendering groups (most recent first)
export const DATE_GROUP_ORDER: DateGroup[] = [
  'today',
  'yesterday',
  'thisWeek',
  'thisMonth',
  'older',
];

/**
 * Get start of day for a given date (midnight)
 */
const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

/**
 * Check if a date is today
 */
export const isToday = (date: Date): boolean => {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  return target.getTime() === today.getTime();
};

/**
 * Check if a date is yesterday
 */
export const isYesterday = (date: Date): boolean => {
  const yesterday = startOfDay(new Date());
  yesterday.setDate(yesterday.getDate() - 1);
  const target = startOfDay(date);
  return target.getTime() === yesterday.getTime();
};

/**
 * Check if a date is within the last 7 days (excluding today and yesterday)
 */
export const isThisWeek = (date: Date): boolean => {
  if (isToday(date) || isYesterday(date)) return false;

  const now = new Date();
  const target = startOfDay(date);
  const weekAgo = startOfDay(new Date());
  weekAgo.setDate(now.getDate() - 7);

  return target.getTime() >= weekAgo.getTime();
};

/**
 * Check if a date is within the last 30 days (excluding this week)
 */
export const isThisMonth = (date: Date): boolean => {
  if (isToday(date) || isYesterday(date) || isThisWeek(date)) return false;

  const now = new Date();
  const target = startOfDay(date);
  const monthAgo = startOfDay(new Date());
  monthAgo.setDate(now.getDate() - 30);

  return target.getTime() >= monthAgo.getTime();
};

/**
 * Get the date group for a given date
 */
export const getDateGroup = (date: Date): DateGroup => {
  if (isToday(date)) return 'today';
  if (isYesterday(date)) return 'yesterday';
  if (isThisWeek(date)) return 'thisWeek';
  if (isThisMonth(date)) return 'thisMonth';
  return 'older';
};

/**
 * Group an array of items by date
 * @param items Array of items with a date property
 * @param getDate Function to extract date from item
 * @returns Record of DateGroup to items array (only non-empty groups)
 */
export const groupByDate = <T>(
  items: T[],
  getDate: (item: T) => Date
): Partial<Record<DateGroup, T[]>> => {
  const groups: Partial<Record<DateGroup, T[]>> = {};

  for (const item of items) {
    const date = getDate(item);
    const group = getDateGroup(date);

    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group]!.push(item);
  }

  return groups;
};
