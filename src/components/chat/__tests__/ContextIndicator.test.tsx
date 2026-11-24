import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ChatUsage } from '../../../utils/chatUsage';
import { ContextIndicator } from '../ContextIndicator';

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
  unpricedReplies: 0,
  allLocal: false,
  replyCosts: new Map(),
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
    expect(screen.getByText('1 reply has no price')).toBeInTheDocument();
  });

  it('renders nothing before a reply has usage', () => {
    const { container } = render(
      <ContextIndicator usage={usage({ contextTokens: 0 })} maxTokens={10000} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
