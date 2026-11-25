import { describe, expect, it } from 'vitest';

import {
  formatCreditAmount,
  formatKiroUsageLine,
  formatResetDate,
  kiroPlanName,
  parseKiroUsage,
} from '../kiroUsage';
import type { KiroUsage } from '../kiroUsage';

const breakdown = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const result = (data: Record<string, unknown> = {}) => ({
  success: true,
  message: 'Plan: KIRO POWER | 1 usage breakdowns',
  data: {
    planName: 'KIRO POWER',
    billingCycleReset: '2026-12-01',
    overagesEnabled: true,
    overageCapable: true,
    isEnterprise: false,
    usageBreakdowns: [breakdown()],
    bonusCredits: [],
    addOnCredits: [],
    ...data,
  },
});

const usage = (overrides: Partial<KiroUsage> = {}): KiroUsage => ({
  planName: 'KIRO POWER',
  resetDate: '2026-12-01',
  credits: { used: 1250, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
  overagesEnabled: false,
  ...overrides,
});

describe('parseKiroUsage', () => {
  it('keeps the known fields', () => {
    expect(parseKiroUsage(result())).toEqual({
      planName: 'KIRO POWER',
      resetDate: '2026-12-01',
      credits: { used: 1250.5, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
      overagesEnabled: true,
    });
  });

  it('does not cap a percentage above 100 and keeps the overage', () => {
    const parsed = parseKiroUsage(
      result({
        usageBreakdowns: [
          breakdown({ used: 1250, limit: 1000, percentage: 125, currentOverages: 250 }),
        ],
      })
    );
    expect(parsed?.credits).toMatchObject({ percentage: 125, overages: 250 });
  });

  it('takes the CREDIT breakdown and ignores other resource types', () => {
    const parsed = parseKiroUsage(
      result({
        usageBreakdowns: [breakdown({ resourceType: 'AGENT_INVOCATION', used: 7 }), breakdown()],
      })
    );
    expect(parsed?.credits?.used).toBe(1250.5);
  });

  it('gives credits null when there is no usable CREDIT breakdown', () => {
    for (const usageBreakdowns of [
      [],
      'x',
      [breakdown({ resourceType: 'OTHER' })],
      [breakdown({ used: '5' })],
      [breakdown({ limit: -1 })],
      [breakdown({ percentage: Number.NaN })],
      [breakdown({ hasLimit: 'yes' })],
    ]) {
      expect(parseKiroUsage(result({ usageBreakdowns }))?.credits).toBeNull();
    }
  });

  it('uses 0 overages when Kiro sends none', () => {
    const parsed = parseKiroUsage(
      result({ usageBreakdowns: [breakdown({ currentOverages: undefined })] })
    );
    expect(parsed?.credits?.overages).toBe(0);
  });

  it('gives resetDate null for a value that is not a real YYYY-MM-DD day', () => {
    for (const billingCycleReset of ['2026-13-01', '2026-02-30', '1 Dec', 20261201, undefined]) {
      expect(parseKiroUsage(result({ billingCycleReset }))?.resetDate).toBeNull();
    }
  });

  it('treats overagesEnabled as false unless it is true', () => {
    expect(parseKiroUsage(result({ overagesEnabled: 'true' }))?.overagesEnabled).toBe(false);
  });

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', []],
    ['success false', { ...result(), success: false }],
    ['no data', { success: true }],
    ['data an array', { success: true, data: [] }],
    ['no plan name', result({ planName: undefined })],
    ['an empty plan name', result({ planName: '  ' })],
    ['a plan name that is too long', result({ planName: 'x'.repeat(81) })],
    ['a plan name that is not a string', result({ planName: 5 })],
  ])('returns null for %s', (_name, input) => {
    expect(parseKiroUsage(input)).toBeNull();
  });
});

describe('kiroPlanName', () => {
  it.each([
    ['KIRO POWER', 'Kiro Power'],
    ['kiro  pro+', 'Kiro Pro+'],
    ['FREE', 'Free'],
  ])('%s → %s', (input, expected) => {
    expect(kiroPlanName(input)).toBe(expected);
  });
});

describe('formatCreditAmount', () => {
  it.each([
    [1250, '1,250'],
    [10000, '10,000'],
    [1250.5, '1,251'],
    [12.4, '12'],
    [9.5, '9.5'],
    [0.05, '0.05'],
    [0.004, '0'],
    [0, '0'],
    [1234567, '1,234,567'],
  ])('%s → %s', (value, expected) => {
    expect(formatCreditAmount(value)).toBe(expected);
  });
});

describe('formatResetDate', () => {
  it.each([
    ['2026-12-01', '1 Dec'],
    ['2026-01-31', '31 Jan'],
    ['2026-07-09', '9 Jul'],
  ])('%s → %s', (input, expected) => {
    expect(formatResetDate(input)).toBe(expected);
  });

  it('returns undefined for no date or a bad date', () => {
    expect(formatResetDate(null)).toBeUndefined();
    expect(formatResetDate('2026-02-30')).toBeUndefined();
  });
});

describe('formatKiroUsageLine', () => {
  it('shows the plan, the credits of the limit, and the reset day', () => {
    expect(formatKiroUsageLine(usage())).toBe(
      'Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec'
    );
  });

  it('adds the credits over the limit, and does not cap the percentage', () => {
    const over = usage({
      credits: { used: 10250, limit: 10000, percentage: 102, overages: 250, hasLimit: true },
    });
    expect(formatKiroUsageLine(over)).toBe(
      'Kiro Power · 10,250 of 10,000 credits used · 250 over the limit · resets 1 Dec'
    );
  });

  it('shows only the credits used when there is no limit', () => {
    const unlimited = usage({
      credits: { used: 1250, limit: 0, percentage: 0, overages: 5, hasLimit: false },
    });
    expect(formatKiroUsageLine(unlimited)).toBe('Kiro Power · 1,250 credits used · resets 1 Dec');
    expect(
      formatKiroUsageLine(
        usage({ credits: { used: 1, limit: 0, percentage: 0, overages: 0, hasLimit: false } })
      )
    ).toContain('1 credit used');
  });

  it('leaves out the parts that Kiro did not send', () => {
    expect(formatKiroUsageLine(usage({ credits: null, resetDate: null }))).toBe('Kiro Power');
    expect(formatKiroUsageLine(usage({ resetDate: null }))).toBe(
      'Kiro Power · 1,250 of 10,000 credits used'
    );
  });
});
