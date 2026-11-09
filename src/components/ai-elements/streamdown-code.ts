/**
 * Streamdown props that turn on syntax highlighting in code blocks, with the Shiki themes
 * of the current color theme.
 */
import { code } from '@streamdown/code';

import { useColorTheme } from '../../hooks/useColorTheme';
import { CODE_THEMES } from './code-themes';

// One object for all renders, so that Streamdown does not see new plugins on each render
const PLUGINS = { code };

export const useStreamdownCode = () => {
  const colorTheme = useColorTheme();
  return { plugins: PLUGINS, shikiTheme: CODE_THEMES[colorTheme] };
};
