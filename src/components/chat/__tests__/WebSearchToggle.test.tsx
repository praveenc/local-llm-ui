import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WebSearchToggle } from '../WebSearchToggle';

describe('WebSearchToggle', () => {
  it('toggles without submitting the chat form', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onToggle = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <WebSearchToggle enabled={false} onToggle={onToggle} />
      </form>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Web search' }));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stays focusable when the model cannot use tools, but does not toggle', async () => {
    const onToggle = vi.fn();
    render(<WebSearchToggle enabled onToggle={onToggle} toolsSupported={false} />);
    const button = screen.getByRole('button', { name: 'Web search' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Shows off, with no Search chip, although the chat keeps search on
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveTextContent('Search');
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.focus(button);
    expect((await screen.findAllByText('This model cannot use tools')).length).toBeGreaterThan(0);
  });

  it('names the primary provider in the tooltip', async () => {
    render(<WebSearchToggle enabled onToggle={vi.fn()} providerLabel="Brave Search" />);
    fireEvent.focus(screen.getByRole('button', { name: 'Web search' }));
    expect(
      (await screen.findAllByText('Web search enabled (Brave Search)')).length
    ).toBeGreaterThan(0);
  });

  it('cannot be clicked while a reply streams', () => {
    render(<WebSearchToggle enabled onToggle={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Web search' })).toBeDisabled();
  });

  it('says Search in words when it is on, and shows only the icon when it is off', () => {
    const { rerender } = render(<WebSearchToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Web search' })).toHaveTextContent('Search');
    rerender(<WebSearchToggle enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Web search' })).not.toHaveTextContent('Search');
  });

  it('reports its state to assistive technology', () => {
    render(<WebSearchToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Web search' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
