import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatErrorAlert } from '../ChatErrorAlert';

describe('ChatErrorAlert', () => {
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
});
