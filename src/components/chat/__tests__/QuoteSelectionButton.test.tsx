import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRef, useState } from 'react';

import { QuoteSelectionButton } from '../QuoteSelectionButton';

// Starts with no messages (container not rendered), like a new chat
function Harness({ onQuote }: { onQuote: (s: { text: string; messageIndex: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasMessages, setHasMessages] = useState(false);
  return (
    <>
      <button onClick={() => setHasMessages(true)}>add</button>
      {hasMessages && (
        <div ref={ref}>
          <div data-message-index="1">
            <p data-testid="msg">Seed its memory with one message</p>
          </div>
        </div>
      )}
      <QuoteSelectionButton containerRef={ref} onQuote={onQuote} />
    </>
  );
}

function selectText(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.getBoundingClientRect = () => ({ top: 100, left: 10, width: 50 }) as DOMRect;
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('QuoteSelectionButton', () => {
  it('appears for a selection in messages rendered after mount', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const onQuote = vi.fn();
    render(<Harness onQuote={onQuote} />);
    fireEvent.click(screen.getByText('add'));

    const msg = screen.getByTestId('msg');
    selectText(msg.firstChild!);
    await act(async () => {
      fireEvent.mouseUp(msg);
    });

    fireEvent.click(screen.getByRole('button', { name: /quote and ask/i }));
    expect(onQuote).toHaveBeenCalledWith({
      text: 'Seed its memory with one message',
      messageIndex: 1,
    });
  });

  it('does not appear for a selection outside messages', async () => {
    render(<Harness onQuote={vi.fn()} />);
    fireEvent.click(screen.getByText('add'));
    selectText(screen.getByText('add').firstChild!);
    await act(async () => {
      fireEvent.mouseUp(screen.getByText('add'));
    });
    expect(screen.queryByRole('button', { name: /quote and ask/i })).not.toBeInTheDocument();
  });
});
