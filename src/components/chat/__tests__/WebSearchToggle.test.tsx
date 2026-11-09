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

  it('reports its state to assistive technology', () => {
    render(<WebSearchToggle enabled onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Web search' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
