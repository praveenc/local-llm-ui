import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const scrollToBottom = vi.fn();
const scrollEl = document.createElement('div');

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({
    isAtBottom: false,
    scrollToBottom,
    scrollRef: { current: scrollEl },
  }),
}));

const { ConversationScrollButton } = await import('../conversation');

describe('ConversationScrollButton', () => {
  it('has an accessible name and moves focus to the log before scrolling', () => {
    document.body.appendChild(scrollEl);
    render(<ConversationScrollButton />);
    const button = screen.getByRole('button', { name: 'Scroll to latest message' });
    button.focus();
    fireEvent.click(button);
    expect(scrollToBottom).toHaveBeenCalled();
    expect(scrollEl).toHaveFocus();
  });
});
