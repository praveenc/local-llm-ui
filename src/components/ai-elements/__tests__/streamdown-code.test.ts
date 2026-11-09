import { beforeEach, describe, expect, it, vi } from 'vitest';

const { highlight, importCount } = vi.hoisted(() => ({
  highlight: vi.fn(),
  importCount: { value: 0 },
}));

// Count imports of the real plugin module
vi.mock('@streamdown/code', () => {
  importCount.value += 1;
  return {
    code: {
      name: 'shiki',
      type: 'code-highlighter',
      getThemes: () => ['github-light', 'github-dark'],
      supportsLanguage: (language: string) => language === 'typescript',
      getSupportedLanguages: () => ['typescript'],
      highlight,
    },
  };
});

const options = {
  code: 'const x = 1;',
  language: 'typescript',
  themes: ['rose-pine-dawn', 'rose-pine'] as [string, string],
};
const result = { tokens: [[{ content: 'const x = 1;' }]] };

describe('lazyCodePlugin', () => {
  beforeEach(() => {
    highlight.mockReset();
  });

  it('loads the plugin on the first highlight and gives the result to the callback', async () => {
    const { lazyCodePlugin, loadCodePlugin } = await import('../streamdown-code');
    expect(importCount.value).toBe(0);

    // A cached result in the real plugin: highlight() returns it at once
    highlight.mockReturnValue(result);
    const callback = vi.fn();
    expect(lazyCodePlugin.highlight(options, callback)).toBeNull();

    await loadCodePlugin();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(result));
    expect(highlight).toHaveBeenCalledWith(options, callback);
    expect(importCount.value).toBe(1);
  });

  it('calls the loaded plugin directly after it loads', async () => {
    const { lazyCodePlugin } = await import('../streamdown-code');
    highlight.mockReturnValue(result);

    expect(lazyCodePlugin.highlight(options)).toBe(result);
    expect(lazyCodePlugin.supportsLanguage('typescript')).toBe(true);
    expect(lazyCodePlugin.supportsLanguage('cobol-not-real')).toBe(false);
    expect(importCount.value).toBe(1);
  });
});
