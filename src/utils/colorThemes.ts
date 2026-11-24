import type { VisualMode } from './preferences';

/**
 * Color themes
 *
 * A color theme is a palette. The light or dark variant follows the visual mode
 * (the sun/moon toggle). Neutral, the default, is the :root palette in styles/globals.css;
 * the others are in styles/themes.css. index.html applies the saved theme before the first
 * paint. A saved 'cosmic-night' stays valid: it is the former default, kept as an option.
 */

export type ColorTheme = 'neutral' | 'cosmic-night' | 'cobaltz' | 'rose-pine';

export const DEFAULT_COLOR_THEME: ColorTheme = 'neutral';

/** Colors for the small preview in the theme picker */
export interface ThemeSwatch {
  /** Variant name shown under the theme name, for example "Dawn" */
  name: string;
  background: string;
  foreground: string;
  primary: string;
  accents: readonly [string, string, string];
}

export interface ColorThemeOption {
  value: ColorTheme;
  label: string;
  light: ThemeSwatch;
  dark: ThemeSwatch;
}

export const COLOR_THEMES: readonly ColorThemeOption[] = [
  {
    value: 'neutral',
    label: 'Neutral',
    light: {
      name: 'Light',
      background: '#fafafa',
      foreground: '#111111',
      primary: '#0f6e73',
      accents: ['#134e52', '#9a4a0e', '#2f7a4d'],
    },
    dark: {
      name: 'Dark',
      background: '#111111',
      foreground: '#ededed',
      primary: '#5ec4c0',
      accents: ['#a7e3df', '#f0a868', '#7fcf9a'],
    },
  },
  {
    value: 'cosmic-night',
    label: 'Cosmic Night',
    light: {
      name: 'Light',
      background: 'oklch(0.973 0.0133 286.1503)',
      foreground: 'oklch(0.3015 0.0572 282.4176)',
      primary: 'oklch(0.5417 0.179 288.0332)',
      accents: [
        'oklch(0.7042 0.1602 288.988)',
        'oklch(0.5679 0.2113 276.7065)',
        'oklch(0.6861 0.2061 14.9941)',
      ],
    },
    dark: {
      name: 'Dark',
      background: 'oklch(0.1743 0.0227 283.7998)',
      foreground: 'oklch(0.9185 0.0257 285.8834)',
      primary: 'oklch(0.7162 0.1597 290.3962)',
      accents: [
        'oklch(0.7482 0.1235 244.7492)',
        'oklch(0.7124 0.0977 186.6761)',
        'oklch(0.7546 0.1831 346.8124)',
      ],
    },
  },
  {
    value: 'cobaltz',
    label: 'Cobaltz',
    light: {
      name: 'Light',
      background: '#FAFBFC',
      foreground: '#0F2438',
      primary: '#2563EB',
      accents: ['#D97706', '#059669', '#9333EA'],
    },
    dark: {
      name: 'Dark',
      background: '#0F2438',
      foreground: '#FFFFFF',
      primary: '#FFCC00',
      accents: ['#82AAFF', '#6FD640', '#ED99FA'],
    },
  },
  {
    value: 'rose-pine',
    label: 'Rosé Pine',
    light: {
      name: 'Dawn',
      background: '#faf4ed',
      foreground: '#464261',
      primary: '#286983',
      accents: ['#d7827e', '#907aa9', '#ea9d34'],
    },
    dark: {
      name: 'Dark',
      background: '#191724',
      foreground: '#e0def4',
      primary: '#ebbcba',
      accents: ['#c4a7e7', '#9ccfd8', '#f6c177'],
    },
  },
];

export const isColorTheme = (value: unknown): value is ColorTheme =>
  COLOR_THEMES.some((theme) => theme.value === value);

export type ResolvedVisualMode = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The OS color scheme; light when the browser cannot tell */
export const systemVisualMode = (): ResolvedVisualMode =>
  typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';

/** The scheme to draw: 'system' becomes the OS scheme, anything unknown becomes light */
export const resolveVisualMode = (mode: unknown): ResolvedVisualMode =>
  mode === 'dark'
    ? 'dark'
    : mode === 'light'
      ? 'light'
      : mode === 'system' || mode === undefined
        ? systemVisualMode()
        : 'light';

/**
 * The header toggle switches to the opposite of what is drawn. When that is the OS scheme it
 * returns 'system', so the app follows the OS again instead of pinning a scheme.
 */
export const toggledVisualMode = (
  drawn: ResolvedVisualMode,
  system: ResolvedVisualMode
): VisualMode => {
  const target = drawn === 'dark' ? 'light' : 'dark';
  return target === system ? 'system' : target;
};

/** Calls onChange when the OS color scheme changes; returns the unsubscribe function */
export const onSystemVisualModeChange = (onChange: () => void): (() => void) => {
  const query = typeof window !== 'undefined' ? window.matchMedia?.(DARK_QUERY) : undefined;
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/**
 * Sets the theme attribute, the dark class, and the color scheme on the root element.
 * The meta tag and the color-scheme property tell the browser to draw its own UI
 * (form controls, autofill, the page canvas) in the same scheme as the palette.
 */
export const applyColorTheme = (
  root: HTMLElement,
  colorTheme: unknown,
  visualMode: unknown
): void => {
  const resolved = resolveVisualMode(visualMode);
  root.dataset.theme = isColorTheme(colorTheme) ? colorTheme : DEFAULT_COLOR_THEME;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const meta = root.ownerDocument.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = resolved;
};

/**
 * Sets data-density on the root element. The `compact:` Tailwind variant (globals.css) and
 * the CSS in themes.css match it.
 */
export const applyContentDensity = (root: HTMLElement, density: unknown): void => {
  root.dataset.density = density === 'compact' ? 'compact' : 'comfortable';
};
