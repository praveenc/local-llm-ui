import { describe, expect, it } from 'vitest';

import { COLOR_THEMES, applyColorTheme, applyContentDensity, isColorTheme } from '../colorThemes';

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

  it('sets data-density to compact for the compact density', () => {
    const root = document.createElement('html');
    applyContentDensity(root, 'compact');
    expect(root.dataset.density).toBe('compact');
  });

  it('sets data-density to comfortable for comfortable and for unknown values', () => {
    const root = document.createElement('html');
    applyContentDensity(root, 'comfortable');
    expect(root.dataset.density).toBe('comfortable');

    applyContentDensity(root, 'compact');
    applyContentDensity(root, undefined);
    expect(root.dataset.density).toBe('comfortable');

    applyContentDensity(root, 'compact');
    applyContentDensity(root, 'bogus');
    expect(root.dataset.density).toBe('comfortable');
  });
});
