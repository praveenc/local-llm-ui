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

  it('stays focusable without a key but does not toggle', () => {
    const onToggle = vi.fn();
    render(<WebSearchToggle enabled={false} onToggle={onToggle} hasApiKey={false} />);
    const button = screen.getByRole('button', { name: 'Web search' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
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
