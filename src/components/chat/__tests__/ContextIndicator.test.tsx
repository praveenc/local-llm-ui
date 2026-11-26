import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatUsage } from '../../../utils/chatUsage';
import type { KiroUsage } from '../../../utils/kiroUsage';
import { ContextIndicator } from '../ContextIndicator';

const kiroUsage = vi.hoisted(() => ({ value: undefined as KiroUsage | null | undefined }));
vi.mock('../../../hooks/useKiroUsage', () => ({ useKiroUsage: () => kiroUsage.value }));

const usage = (overrides: Partial<ChatUsage> = {}): ChatUsage => ({
  contextTokens: 1200,
  totals: {
    inputTokens: 2400,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    replies: 2,
  },
  cost: 0.0123,
  tokenReplies: 2,
  unpricedReplies: 0,
  allLocal: false,
  replyCosts: new Map(),
  credits: 0,
  kiroReplies: 0,
  ...overrides,
});

describe('ContextIndicator', () => {
  it('names the trigger with the percentage of the context window', () => {
    render(<ContextIndicator usage={usage()} maxTokens={10000} />);
    expect(screen.getByRole('button', { name: 'Context used: 12%' })).toBeInTheDocument();
  });

  it('opens the breakdown on click and closes it on Escape', async () => {
    const user = userEvent.setup();
    render(<ContextIndicator usage={usage()} maxTokens={10000} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Context used: 12%' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('12% of the context window')).toBeInTheDocument();
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('$0.012')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says in words when the context is near the limit and almost full', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ContextIndicator usage={usage({ contextTokens: 7500 })} maxTokens={10000} />
    );
    const near = screen.getByRole('button', { name: 'Context used: 75%, near the limit' });
    expect(near).toHaveAttribute('data-level', 'near');
    await user.click(near);
    expect(await screen.findByText('Near the limit.')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    rerender(<ContextIndicator usage={usage({ contextTokens: 9500 })} maxTokens={10000} />);
    expect(screen.getByRole('button', { name: 'Context used: 95%, almost full' })).toHaveAttribute(
      'data-level',
      'full'
    );
  });

  it('shows cached and reasoning tokens when the chat has them', async () => {
    const user = userEvent.setup();
    const totals = { ...usage().totals, cacheReadTokens: 1800, reasoningTokens: 150 };
    render(<ContextIndicator usage={usage({ totals })} maxTokens={10000} />);
    await user.click(screen.getByRole('button', { name: /Context used/ }));
    expect(await screen.findByText('1.8K cached')).toBeInTheDocument();
    expect(screen.getByText('150 reasoning')).toBeInTheDocument();
  });

  it('says No price data instead of $0.00 for a model without a price', async () => {
    const user = userEvent.setup();
    render(
      <ContextIndicator usage={usage({ cost: undefined, unpricedReplies: 2 })} maxTokens={10000} />
    );
    await user.click(screen.getByRole('button', { name: /Context used/ }));
    expect(await screen.findByText('No price data')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('says Free for local models and counts replies without a price', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ContextIndicator usage={usage({ cost: 0, allLocal: true })} maxTokens={10000} />
    );
    await user.click(screen.getByRole('button', { name: /Context used/ }));
    expect(await screen.findByText('Free')).toBeInTheDocument();

    rerender(<ContextIndicator usage={usage({ unpricedReplies: 1 })} maxTokens={10000} />);
    expect(screen.getByText('1 reply has no price data')).toBeInTheDocument();
  });

  it('renders nothing before a reply has usage', () => {
    const totals = { ...usage().totals, inputTokens: 0, outputTokens: 0, replies: 0 };
    const { container } = render(
      <ContextIndicator
        usage={usage({ contextTokens: 0, totals, tokenReplies: 0, cost: undefined })}
        maxTokens={10000}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the totals without a fill when the current model has not replied last', async () => {
    const user = userEvent.setup();
    for (const props of [{ maxTokens: 10000 }, { maxTokens: undefined }, { kiro: true }]) {
      const { unmount } = render(
        <ContextIndicator usage={usage({ contextTokens: 0 })} {...props} />
      );
      expect(screen.queryByRole('button', { name: /Context used/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Usage of this chat' }));
      expect(
        await screen.findByText('Context use shows after the next reply from this model.')
      ).toBeInTheDocument();
      expect(screen.queryByText(/of the context window/)).not.toBeInTheDocument();
      expect(screen.getByText('This chat')).toBeInTheDocument();
      expect(screen.getByText('$0.012')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('ContextIndicator for Kiro', () => {
  beforeEach(() => {
    kiroUsage.value = undefined;
  });

  const kiroChat = () =>
    usage({
      totals: { ...usage().totals, inputTokens: 0, outputTokens: 0 },
      tokenReplies: 0,
      cost: undefined,
      credits: 0.25,
      kiroReplies: 2,
      contextPercent: 30,
    });

  const mixedChat = () =>
    usage({
      totals: { ...usage().totals, replies: 4 },
      credits: 0.63,
      kiroReplies: 2,
      contextPercent: 9,
    });

  const account: KiroUsage = {
    planName: 'KIRO POWER',
    resetDate: '2026-12-01',
    credits: { used: 1250, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
    overagesEnabled: false,
  };

  it('shows the tokens, the cost, the credits, and the account for a mixed chat', async () => {
    const user = userEvent.setup();
    kiroUsage.value = account;
    render(<ContextIndicator usage={mixedChat()} kiro />);
    await user.click(screen.getByRole('button', { name: 'Context used: 9%' }));
    expect(await screen.findByText('This chat')).toBeInTheDocument();
    expect(screen.getByText('2.4K')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('$0.012')).toBeInTheDocument();
    expect(screen.getByText('Credits in this chat')).toBeInTheDocument();
    expect(screen.getByText('0.63 credits')).toBeInTheDocument();
    expect(screen.getByText('Kiro account')).toBeInTheDocument();
  });

  it('shows the credits of a mixed chat also when the current model is not Kiro', async () => {
    const user = userEvent.setup();
    render(<ContextIndicator usage={mixedChat()} maxTokens={10000} />);
    await user.click(screen.getByRole('button', { name: 'Context used: 12%' }));
    expect(await screen.findByText('$0.012')).toBeInTheDocument();
    expect(screen.getByText('0.63 credits')).toBeInTheDocument();
  });

  it('shows no cost line for a chat of Kiro replies only', async () => {
    const user = userEvent.setup();
    render(<ContextIndicator usage={kiroChat()} kiro />);
    await user.click(screen.getByRole('button', { name: /Context used: 30%/ }));
    expect(await screen.findByText('Credits in this chat')).toBeInTheDocument();
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('This chat')).not.toBeInTheDocument();
  });

  it('shows the credits of the chat and the plan and credits of the account', async () => {
    const user = userEvent.setup();
    kiroUsage.value = {
      planName: 'KIRO POWER',
      resetDate: '2026-12-01',
      credits: { used: 1250, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
      overagesEnabled: false,
    };
    render(<ContextIndicator usage={kiroChat()} kiro />);
    await user.click(screen.getByRole('button', { name: /Context used: 30%/ }));
    expect(await screen.findByText('Credits in this chat')).toBeInTheDocument();
    expect(screen.getByText('0.25 credits')).toBeInTheDocument();
    expect(screen.getByText('Kiro account')).toBeInTheDocument();
    expect(
      screen.getByText('Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec')
    ).toBeInTheDocument();
  });

  it('shows no account line while it loads or when Kiro cannot tell', async () => {
    const user = userEvent.setup();
    for (const value of [undefined, null]) {
      kiroUsage.value = value;
      const { unmount } = render(<ContextIndicator usage={kiroChat()} kiro />);
      await user.click(screen.getByRole('button', { name: /Context used: 30%/ }));
      expect(await screen.findByText('Credits in this chat')).toBeInTheDocument();
      expect(screen.queryByText('Kiro account')).not.toBeInTheDocument();
      unmount();
    }
  });
});
