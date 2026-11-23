import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelSelectorButton } from '../ModelSelectorButton';

describe('ModelSelectorButton', () => {
  it('opens on Ctrl+K and shows the shortcut in its tooltip', () => {
    render(<ModelSelectorButton providers={[]} selectedModel={null} onSelectModel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Select model/ })).toHaveAttribute(
      'title',
      expect.stringMatching(/K\)$/)
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('Search models...')).toBeInTheDocument();
  });

  it('ignores the shortcut while disabled', () => {
    render(
      <ModelSelectorButton providers={[]} selectedModel={null} onSelectModel={vi.fn()} disabled />
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Search models...')).not.toBeInTheDocument();
  });
});
