import { act, cleanup, renderHook } from '@testing-library/react';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useColorTheme } from '../../../hooks/useColorTheme';
import { COLOR_THEMES } from '../../../utils/colorThemes';
import { CODE_THEMES } from '../code-themes';
import { useStreamdownCode } from '../streamdown-code';

const themeName = (theme: unknown) =>
  typeof theme === 'string' ? theme : (theme as { name?: string }).name;

describe('code block themes', () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error');
  });

  afterEach(async () => {
    // Unmount first: the next line changes the attribute that useColorTheme observes
    cleanup();
    delete document.documentElement.dataset.theme;
    // The MutationObserver callback runs in a microtask, so wait for it before the check
    await new Promise((resolve) => setTimeout(resolve, 0));
    const actWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes('not wrapped in act')
    );
    consoleError.mockRestore();
    expect(actWarnings).toHaveLength(0);
  });

  it('has a light and a dark code theme for every color theme', () => {
    for (const { value } of COLOR_THEMES) {
      expect(CODE_THEMES[value]).toHaveLength(2);
    }
    expect(CODE_THEMES['rose-pine']).toEqual(['rose-pine-dawn', 'rose-pine']);
    expect(CODE_THEMES.cobaltz.map(themeName)).toEqual(['Cobaltz Light', 'Cobaltz']);
  });

  it('follows the color theme on the root element', async () => {
    document.documentElement.dataset.theme = 'rose-pine';
    const { result } = renderHook(() => useStreamdownCode());
    expect(result.current.shikiTheme).toBe(CODE_THEMES['rose-pine']);
    expect(result.current.plugins.code).toBeDefined();

    // AppShell changes the attribute when the user picks a theme
    await act(async () => {
      document.documentElement.dataset.theme = 'cobaltz';
      await Promise.resolve();
    });
    expect(result.current.shikiTheme).toBe(CODE_THEMES.cobaltz);
  });

  it('uses Neutral for a missing or unknown theme', () => {
    const { result } = renderHook(() => useColorTheme());
    expect(result.current).toBe('neutral');
  });
});
