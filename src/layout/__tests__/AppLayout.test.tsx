import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppLayout } from '../AppLayout';

const renderLayout = () =>
  render(
    <AppLayout
      navigation={<div>nav</div>}
      theme="light"
      onToggleTheme={vi.fn()}
      colorTheme="cobaltz"
      onColorThemeChange={vi.fn()}
      onVisualModeChange={vi.fn()}
    >
      <div>content</div>
    </AppLayout>
  );

describe('AppLayout', () => {
  it('names the sidebar toggles', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeInTheDocument();
  });

  it('opens a named phone sheet with one close button', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    const sheet = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(sheet).getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });
});
