/**
 * Streamdown props that turn on syntax highlighting in code blocks, with the Shiki themes
 * of the current color theme.
 *
 * The code plugin (@streamdown/code, with the Shiki core) loads only when the first code
 * block needs it, so it is not in the main bundle. Until it loads, code blocks show plain
 * text; then Streamdown calls back with the highlighted result.
 */
import type { CodeHighlighterPlugin } from 'streamdown';

import { useColorTheme } from '../../hooks/useColorTheme';
import { CODE_THEMES } from './code-themes';

type HighlightOptions = Parameters<CodeHighlighterPlugin['highlight']>[0];
type HighlightCallback = Parameters<CodeHighlighterPlugin['highlight']>[1];

let loaded: CodeHighlighterPlugin | undefined;
let loading: Promise<CodeHighlighterPlugin> | undefined;

/** Load the plugin once; later calls get the same promise */
export const loadCodePlugin = (): Promise<CodeHighlighterPlugin> => {
  loading ??= import('@streamdown/code').then(({ code }) => {
    loaded = code;
    return code;
  });
  return loading;
};

/** Stands in for the real plugin and loads it on the first highlight */
export const lazyCodePlugin: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  // Streamdown takes the themes from the shikiTheme prop, so these are only a fallback
  getThemes: () => CODE_THEMES['cosmic-night'],
  // Shiki loads each grammar on demand and falls back to plain text for unknown languages
  supportsLanguage: (language) => loaded?.supportsLanguage(language) ?? true,
  getSupportedLanguages: () => loaded?.getSupportedLanguages() ?? [],
  highlight(options: HighlightOptions, callback?: HighlightCallback) {
    if (loaded) return loaded.highlight(options, callback);
    loadCodePlugin()
      .then((plugin) => {
        const result = plugin.highlight(options, callback);
        // A result from the cache comes back now instead of through the callback
        if (result) callback?.(result);
      })
      .catch((error: unknown) => console.error('Could not load the code highlighter:', error));
    return null;
  },
};

// One object for all renders, so that Streamdown does not see new plugins on each render
const PLUGINS = { code: lazyCodePlugin };

export const useStreamdownCode = () => {
  const colorTheme = useColorTheme();
  return { plugins: PLUGINS, shikiTheme: CODE_THEMES[colorTheme] };
};
