import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InferenceSettings } from '../InferenceSettings';

function renderOpen() {
  render(
    <InferenceSettings
      maxTokens={4096}
      setMaxTokens={vi.fn()}
      maxToolSteps={12}
      setMaxToolSteps={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button'));
}

describe('InferenceSettings', () => {
  it('does not show Temperature or Top P', () => {
    renderOpen();
    expect(screen.queryByText('Temperature')).not.toBeInTheDocument();
    expect(screen.queryByText('Top P')).not.toBeInTheDocument();
    expect(screen.queryByText('Sampling Parameter')).not.toBeInTheDocument();
  });

  it('shows Max Tokens and Max Tool Steps', () => {
    renderOpen();
    expect(screen.getByText('Max Tokens')).toBeInTheDocument();
    expect(screen.getByText('Max Tool Steps')).toBeInTheDocument();
    expect(screen.getByTestId('max-tool-steps-value')).toHaveTextContent('12');
  });
});
