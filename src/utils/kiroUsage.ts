/**
 * Kiro account credits: what `_kiro/account/getUsage` returns, the parser that keeps only the
 * fields the app knows, and the text that the app shows. Shared by the browser and the server,
 * so no DOM or Node imports.
 *
 * Kiro's result is `{ success, message, data: { planName, billingCycleReset, overagesEnabled,
 * usageBreakdowns: [{ resourceType, used, limit, percentage, currentOverages, hasLimit, … }],
 * … } }`. The app shows Kiro's own numbers and never works them out again.
 */

export interface KiroCredits {
  /** Credits used in this billing cycle */
  used: number;
  /** The credit limit. Not meaningful when `hasLimit` is false. */
  limit: number;
  /** Kiro's own percentage. It can be above 100 and the app does not cap it. */
  percentage: number;
  /** Credits over the limit */
  overages: number;
  hasLimit: boolean;
}

export interface KiroUsage {
  /** As Kiro writes it, for example "KIRO POWER". Use `kiroPlanName` to show it. */
  planName: string;
  /** The day the billing cycle resets, as `YYYY-MM-DD`, or null when Kiro sends none */
  resetDate: string | null;
  /** The CREDIT breakdown, or null when Kiro lists none */
  credits: KiroCredits | null;
  overagesEnabled: boolean;
}

const MAX_PLAN_NAME = 80;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function parseCredits(breakdowns: unknown): KiroCredits | null {
  if (!Array.isArray(breakdowns)) return null;
  for (const item of breakdowns) {
    const entry = asRecord(item);
    if (entry?.resourceType !== 'CREDIT') continue;
    const { used, limit, percentage, hasLimit } = entry;
    if (!isAmount(used) || !isAmount(limit) || !isAmount(percentage)) return null;
    if (typeof hasLimit !== 'boolean') return null;
    const overages = isAmount(entry.currentOverages) ? entry.currentOverages : 0;
    return { used, limit, percentage, overages, hasLimit };
  }
  return null;
}

/** A real calendar day written as YYYY-MM-DD, or null */
function parseResetDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : null;
}

/**
 * The usage in a `_kiro/account/getUsage` result, or null when the result is not a successful
 * answer with a plan name. It reads only the fields above, each with its type, and ignores the
 * rest (the bonus and add-on credits have an unknown shape).
 */
export function parseKiroUsage(result: unknown): KiroUsage | null {
  const root = asRecord(result);
  if (root?.success !== true) return null;
  const data = asRecord(root.data);
  if (!data) return null;
  const planName = typeof data.planName === 'string' ? data.planName.trim() : '';
  if (!planName || planName.length > MAX_PLAN_NAME) return null;
  return {
    planName,
    resetDate: parseResetDate(data.billingCycleReset),
    credits: parseCredits(data.usageBreakdowns),
    overagesEnabled: data.overagesEnabled === true,
  };
}

/** "KIRO POWER" → "Kiro Power" */
export function kiroPlanName(planName: string): string {
  return planName
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const smallNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** "1,250", "10,000", "0.05", "9.5". Whole numbers with grouping; below 10, up to 2 decimals. */
export function formatCreditAmount(value: number): string {
  return (Math.abs(value) < 10 ? smallNumber : wholeNumber).format(value);
}

/** "2026-12-01" → "1 Dec". Returns undefined for anything else. */
export function formatResetDate(resetDate: string | null): string | undefined {
  const parsed = parseResetDate(resetDate);
  if (!parsed) return undefined;
  const [, month, day] = parsed.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * "Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec". Without a limit: "1,250 credits
 * used". Over the limit: "· 250 over the limit". Without credits, only the plan and the date.
 */
export function formatKiroUsageLine(usage: KiroUsage): string {
  const parts = [kiroPlanName(usage.planName)];
  const { credits } = usage;
  if (credits) {
    const used = formatCreditAmount(credits.used);
    if (credits.hasLimit) {
      parts.push(`${used} of ${formatCreditAmount(credits.limit)} credits used`);
      if (credits.overages > 0) {
        parts.push(`${formatCreditAmount(credits.overages)} over the limit`);
      }
    } else {
      parts.push(`${used} ${used === '1' ? 'credit' : 'credits'} used`);
    }
  }
  const reset = formatResetDate(usage.resetDate);
  if (reset) parts.push(`resets ${reset}`);
  return parts.join(' · ');
}
