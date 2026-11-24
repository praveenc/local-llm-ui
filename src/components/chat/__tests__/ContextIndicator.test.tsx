import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ContextIndicator } from '../ContextIndicator';

describe('ContextIndicator', () => {
  it('names the trigger with the percentage used', () => {
    render(<ContextIndicator usedTokens={1200} maxTokens={10000} />);
    expect(screen.getByRole('button', { name: 'Context used: 12%' })).toBeInTheDocument();
  });

  it('opens the breakdown on click and closes it on Escape', async () => {
    const user = userEvent.setup();
    render(
      <ContextIndicator usedTokens={1200} maxTokens={10000} inputTokens={800} outputTokens={400} />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Context used: 12%' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing before any tokens are used', () => {
    const { container } = render(<ContextIndicator usedTokens={0} maxTokens={10000} />);
    expect(container).toBeEmptyDOMElement();
  });
});
