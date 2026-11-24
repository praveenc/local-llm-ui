import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppLayout } from '../AppLayout';

const renderLayout = () =>
  render(
    <AppLayout
      navigation={<div>nav</div>}
      visualMode="light"
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
  it('shows one h1 with the conversation title', () => {
    const { rerender } = renderLayout();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New conversation');

    rerender(
      <AppLayout
        navigation={<div>nav</div>}
        title="Trip plan"
        visualMode="light"
        theme="light"
        onToggleTheme={vi.fn()}
        colorTheme="cobaltz"
        onColorThemeChange={vi.fn()}
        onVisualModeChange={vi.fn()}
      >
        <div>content</div>
      </AppLayout>
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trip plan');
  });

  it('shows no generic subtitle under the product name', () => {
    renderLayout();
    expect(screen.queryByText('Chat Interface')).not.toBeInTheDocument();
  });

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
