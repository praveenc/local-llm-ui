import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuoteRespondDialog } from '../QuoteRespondDialog';

const setup = (forkDisabledReason?: string) => {
  const onSendToFork = vi.fn();
  const onClose = vi.fn();
  render(
    <QuoteRespondDialog
      quote="Red Blue Green"
      onClose={onClose}
      onSendToCompose={vi.fn()}
      onSendToFork={onSendToFork}
      forkDisabledReason={forkDisabledReason}
    />
  );
  fireEvent.change(screen.getByPlaceholderText('Your response...'), {
    target: { value: 'Why these?' },
  });
  return { onSendToFork, onClose, fork: screen.getByRole('button', { name: /send to fork/i }) };
};

describe('QuoteRespondDialog', () => {
  it('uses the "Quote and Ask" title', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Quote and Ask' })).toBeInTheDocument();
  });

  it('enables Send to Fork when there is a response and no blocking reason', () => {
    const { fork, onSendToFork } = setup();
    expect(fork).toBeEnabled();
    expect(screen.queryByTestId('fork-disabled-reason')).not.toBeInTheDocument();
    fireEvent.click(fork);
    expect(onSendToFork).toHaveBeenCalledWith('Why these?');
  });

  it('shows why Send to Fork is disabled', () => {
    const { fork } = setup('select a model first');
    expect(fork).toBeDisabled();
    expect(screen.getByTestId('fork-disabled-reason')).toHaveTextContent(
      'Send to Fork is not available: select a model first.'
    );
  });

  it('keeps a typed response when Escape is pressed, until Discard', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Your response...')).toHaveValue('Why these?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });
});
