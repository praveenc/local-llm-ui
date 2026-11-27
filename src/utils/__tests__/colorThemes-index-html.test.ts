import { describe, expect, it } from 'vitest';

import INDEX_HTML from '../../../index.html?raw';
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from '../colorThemes';

/**
 * index.html sets the theme in an inline script before the first paint, and that script cannot
 * import TypeScript. It keeps its own list of theme ids. This test keeps that list and
 * COLOR_THEMES the same, so a new theme cannot miss the pre-paint script.
 */

/** The ids in `var themes = [...]` of the inline script, in order */
const inlineThemeIds = (html: string): string[] => {
  const match = /var\s+themes\s*=\s*\[([^\]]*)\]/.exec(html);
  if (!match) throw new Error('index.html has no `var themes = [...]` list');
  return Array.from(match[1].matchAll(/'([^']*)'|"([^"]*)"/g), (m) => m[1] ?? m[2]);
};

/** Describe each difference between the two lists, or return an empty list */
const themeDrift = (html: string): string[] => {
  const inline = inlineThemeIds(html);
  const typed = COLOR_THEMES.map((theme) => theme.value) as string[];
  return [
    ...typed.filter((id) => !inline.includes(id)).map((id) => `missing from index.html: ${id}`),
    ...inline.filter((id) => !typed.includes(id)).map((id) => `missing from COLOR_THEMES: ${id}`),
    ...(inline[0] !== DEFAULT_COLOR_THEME
      ? [`index.html default is ${inline[0]}, not ${DEFAULT_COLOR_THEME}`]
      : []),
  ];
};

describe('theme ids in index.html and COLOR_THEMES', () => {
  it('are the same, with the default first', () => {
    expect(themeDrift(INDEX_HTML)).toEqual([]);
    expect(inlineThemeIds(INDEX_HTML)).toEqual(COLOR_THEMES.map((theme) => theme.value));
  });

  it('reports a theme that is removed from a copy of index.html', () => {
    const copy = INDEX_HTML.replace(", 'cobaltz'", '');
    expect(copy).not.toBe(INDEX_HTML);
    expect(themeDrift(copy)).toEqual(['missing from index.html: cobaltz']);
  });

  it('reports a theme that only index.html has, and a different default', () => {
    const extra = INDEX_HTML.replace("'rose-pine']", "'rose-pine', 'solarized']");
    expect(themeDrift(extra)).toEqual(['missing from COLOR_THEMES: solarized']);

    const reordered = INDEX_HTML.replace(
      "['neutral', 'cosmic-night'",
      "['cosmic-night', 'neutral'"
    );
    expect(reordered).not.toBe(INDEX_HTML);
    expect(themeDrift(reordered)).toEqual(['index.html default is cosmic-night, not neutral']);
  });

  it('fails loudly when the list is not found', () => {
    expect(() => inlineThemeIds('<html></html>')).toThrow(/no `var themes/);
  });
});
