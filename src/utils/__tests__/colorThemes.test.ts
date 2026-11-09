import { describe, expect, it } from 'vitest';

import { COLOR_THEMES, applyColorTheme, isColorTheme } from '../colorThemes';

describe('colorThemes', () => {
  it('offers Cosmic Night, Cobaltz, and Rosé Pine', () => {
    expect(COLOR_THEMES.map((theme) => theme.value)).toEqual([
      'cosmic-night',
      'cobaltz',
      'rose-pine',
    ]);
  });

  it('recognises only known themes', () => {
    expect(isColorTheme('cobaltz')).toBe(true);
    expect(isColorTheme('solarized')).toBe(false);
    expect(isColorTheme(undefined)).toBe(false);
  });

  it('sets the theme attribute and the dark class', () => {
    const root = document.createElement('html');
    applyColorTheme(root, 'rose-pine', 'dark');
    expect(root.dataset.theme).toBe('rose-pine');
    expect(root.classList.contains('dark')).toBe(true);

    applyColorTheme(root, 'cobaltz', 'light');
    expect(root.dataset.theme).toBe('cobaltz');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('falls back to Cosmic Night for an unknown saved theme', () => {
    const root = document.createElement('html');
    applyColorTheme(root, 'removed-theme', 'light');
    expect(root.dataset.theme).toBe('cosmic-night');
  });
});
