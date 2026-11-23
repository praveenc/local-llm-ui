import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatErrorAlert } from '../ChatErrorAlert';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

describe('ChatErrorAlert', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });
  it('retries the last message', () => {
    const onRetry = vi.fn();
    render(<ChatErrorAlert error="Network down" onRetry={onRetry} onChangeModel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    // Not a model problem, so no model switch is offered
    expect(screen.queryByRole('button', { name: 'Change model' })).not.toBeInTheDocument();
  });

  it('offers another model when the model cannot do the request', () => {
    const onChangeModel = vi.fn();
    render(
      <ChatErrorAlert
        error="Tool calling is not supported for this model"
        onChangeModel={onChangeModel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change model' }));
    expect(onChangeModel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows and announces the copied state on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ChatErrorAlert error="Network down" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith('Copied');
  });

  it('shows failure and does not throw when the write is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<ChatErrorAlert error="Network down" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
    );
    expect(toastError).toHaveBeenCalledWith('Copy failed');
    consoleError.mockRestore();
  });
});
