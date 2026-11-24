import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COLOR_THEMES,
  applyColorTheme,
  applyContentDensity,
  isColorTheme,
  resolveVisualMode,
  toggledVisualMode,
} from '../colorThemes';

describe('colorThemes', () => {
  it('offers Neutral first, then Cosmic Night, Cobaltz, and Rosé Pine', () => {
    expect(COLOR_THEMES.map((theme) => theme.value)).toEqual([
      'neutral',
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

  it('falls back to Neutral for an unknown saved theme', () => {
    const root = document.createElement('html');
    applyColorTheme(root, 'removed-theme', 'light');
    expect(root.dataset.theme).toBe('neutral');
  });

  it('keeps a saved Cosmic Night choice', () => {
    const root = document.createElement('html');
    applyColorTheme(root, 'cosmic-night', 'dark');
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

  describe('visual mode', () => {
    const mockSystem = (dark: boolean) =>
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: dark && query === '(prefers-color-scheme: dark)',
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }))
      );
    afterEach(() => vi.unstubAllGlobals());

    it('resolves system from the OS setting and keeps an explicit light or dark', () => {
      mockSystem(true);
      expect(resolveVisualMode('system')).toBe('dark');
      expect(resolveVisualMode(undefined)).toBe('dark');
      expect(resolveVisualMode('light')).toBe('light');
      mockSystem(false);
      expect(resolveVisualMode('system')).toBe('light');
      expect(resolveVisualMode('dark')).toBe('dark');
    });

    it('toggles to the opposite scheme, and to system when that matches the OS', () => {
      expect(toggledVisualMode('light', 'light')).toBe('dark');
      expect(toggledVisualMode('dark', 'light')).toBe('system');
      expect(toggledVisualMode('dark', 'dark')).toBe('light');
      expect(toggledVisualMode('light', 'dark')).toBe('system');
    });

    it('sets color-scheme and the meta tag to the drawn scheme', () => {
      mockSystem(true);
      const meta = document.createElement('meta');
      meta.name = 'color-scheme';
      meta.content = 'light dark';
      document.head.appendChild(meta);
      const root = document.documentElement;
      applyColorTheme(root, 'neutral', 'system');
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.style.colorScheme).toBe('dark');
      expect(meta.content).toBe('dark');
      applyColorTheme(root, 'neutral', 'light');
      expect(root.style.colorScheme).toBe('light');
      expect(meta.content).toBe('light');
      meta.remove();
      root.classList.remove('dark');
      root.style.colorScheme = '';
    });
  });
});
