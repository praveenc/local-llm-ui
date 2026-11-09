/**
 * The color theme on <html data-theme> (set by AppShell and index.html).
 * Components re-render when the user changes the theme.
 */
import { useSyncExternalStore } from 'react';

import { DEFAULT_COLOR_THEME, isColorTheme } from '../utils/colorThemes';
import type { ColorTheme } from '../utils/colorThemes';

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
};

const getSnapshot = (): ColorTheme => {
  const value = document.documentElement.dataset.theme;
  return isColorTheme(value) ? value : DEFAULT_COLOR_THEME;
};

export const useColorTheme = (): ColorTheme =>
  useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_COLOR_THEME);
