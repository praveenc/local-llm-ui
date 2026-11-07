import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SamplingSupport } from '../../../utils/samplingParams';
import { InferenceSettings } from '../InferenceSettings';

function renderOpen(samplingSupport: SamplingSupport, samplingParameter: 'temperature' | 'topP') {
  render(
    <InferenceSettings
      temperature={0.5}
      setTemperature={vi.fn()}
      topP={0.9}
      setTopP={vi.fn()}
      maxTokens={4096}
      setMaxTokens={vi.fn()}
      samplingParameter={samplingParameter}
      setSamplingParameter={vi.fn()}
      samplingSupport={samplingSupport}
    />
  );
  fireEvent.click(screen.getByRole('button'));
}

describe('InferenceSettings', () => {
  it('hides Temperature and Top P for models that reject them', () => {
    renderOpen('none', 'temperature');
    expect(screen.getByTestId('sampling-not-supported')).toBeInTheDocument();
    expect(screen.queryByText('Sampling Parameter')).not.toBeInTheDocument();
    expect(screen.queryByText('0.50')).not.toBeInTheDocument();
    expect(screen.queryByText('0.90')).not.toBeInTheDocument();
    expect(screen.getByText('Max Tokens')).toBeInTheDocument();
  });

  it('shows the toggle and one slider for models that accept one parameter', () => {
    renderOpen('one', 'topP');
    expect(screen.getByText('Sampling Parameter')).toBeInTheDocument();
    expect(screen.getByText('0.90')).toBeInTheDocument();
    expect(screen.queryByText('0.50')).not.toBeInTheDocument();
  });

  it('shows both sliders and no toggle for models that accept both', () => {
    renderOpen('both', 'temperature');
    expect(screen.queryByText('Sampling Parameter')).not.toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText('0.90')).toBeInTheDocument();
  });
});
