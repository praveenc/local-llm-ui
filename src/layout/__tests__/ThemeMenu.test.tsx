import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeMenu } from '../ThemeMenu';

const renderMenu = () => {
  const onColorThemeChange = vi.fn();
  const onVisualModeChange = vi.fn();
  render(
    <ThemeMenu
      colorTheme="cobaltz"
      visualMode="dark"
      onColorThemeChange={onColorThemeChange}
      onVisualModeChange={onVisualModeChange}
    />
  );
  return { onColorThemeChange, onVisualModeChange };
};

describe('ThemeMenu', () => {
  it('lists the color themes and marks the current theme and mode', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Theme' }));

    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(items).toEqual(['Cosmic Night', 'Cobaltz', 'Rosé Pine', 'Light', 'Dark']);
    expect(screen.getByRole('menuitemradio', { name: 'Cobaltz' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();
  });

  it('returns the theme picked', async () => {
    const user = userEvent.setup();
    const { onColorThemeChange, onVisualModeChange } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Rosé Pine' }));
    expect(onColorThemeChange).toHaveBeenCalledWith('rose-pine');
    expect(onVisualModeChange).not.toHaveBeenCalled();
  });

  it('returns the mode picked', async () => {
    const user = userEvent.setup();
    const { onVisualModeChange } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(onVisualModeChange).toHaveBeenCalledWith('light');
  });
});
