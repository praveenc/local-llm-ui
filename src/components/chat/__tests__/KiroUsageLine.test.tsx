import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroUsage } from '../../../utils/kiroUsage';
import { KiroUsageLine } from '../KiroUsageLine';

const hook = vi.hoisted(() => ({ value: undefined as KiroUsage | null | undefined }));
vi.mock('../../../hooks/useKiroUsage', () => ({ useKiroUsage: () => hook.value }));

const usage = (overrides: Partial<KiroUsage> = {}): KiroUsage => ({
  planName: 'KIRO POWER',
  resetDate: '2026-12-01',
  credits: { used: 1250, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
  overagesEnabled: false,
  ...overrides,
});

describe('KiroUsageLine', () => {
  beforeEach(() => {
    hook.value = undefined;
  });

  it('shows the plan, the credits, and the reset day', () => {
    hook.value = usage();
    render(<KiroUsageLine />);
    expect(
      screen.getByText('Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec')
    ).toBeInTheDocument();
  });

  it('shows the credits over the limit and does not cap the percentage', () => {
    hook.value = usage({
      credits: { used: 10250, limit: 10000, percentage: 102, overages: 250, hasLimit: true },
    });
    render(<KiroUsageLine />);
    expect(
      screen.getByText(/10,250 of 10,000 credits used · 250 over the limit/)
    ).toBeInTheDocument();
  });

  it('shows no limit when the plan has none', () => {
    hook.value = usage({
      credits: { used: 1250, limit: 0, percentage: 0, overages: 0, hasLimit: false },
    });
    render(<KiroUsageLine />);
    expect(screen.getByText('Kiro Power · 1,250 credits used · resets 1 Dec')).toBeInTheDocument();
  });

  it('adds its label only when the line shows', () => {
    hook.value = usage();
    const { rerender } = render(<KiroUsageLine label="Kiro account" />);
    expect(screen.getByText('Kiro account')).toBeInTheDocument();
    hook.value = null;
    rerender(<KiroUsageLine label="Kiro account" />);
    expect(screen.queryByText('Kiro account')).not.toBeInTheDocument();
  });

  it('shows nothing while it loads and when Kiro cannot tell', () => {
    for (const value of [undefined, null]) {
      hook.value = value;
      const { container, unmount } = render(<KiroUsageLine />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
