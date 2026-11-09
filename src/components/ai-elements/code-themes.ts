/**
 * Syntax highlighting themes for code blocks in chat replies, one light and dark pair for
 * each color theme. Shiki has the Rosé Pine and One themes built in. The Cobaltz themes are
 * the VS Code theme files from github.com/praveenc/cobaltz (MIT).
 */
import type { ThemeRegistrationAny } from 'shiki';

import cobaltzLight from '../../assets/code-themes/cobaltz-light.json';
import cobaltzDark from '../../assets/code-themes/cobaltz.json';
import type { ColorTheme } from '../../utils/colorThemes';

type CodeTheme = string | ThemeRegistrationAny;

/** [light, dark] Shiki themes; the visual mode picks one */
export const CODE_THEMES: Record<ColorTheme, [CodeTheme, CodeTheme]> = {
  'cosmic-night': ['one-light', 'one-dark-pro'],
  cobaltz: [cobaltzLight as ThemeRegistrationAny, cobaltzDark as ThemeRegistrationAny],
  'rose-pine': ['rose-pine-dawn', 'rose-pine'],
};
