import { describe, expect, it } from 'vitest';

import { isFocusComposerShortcut, isModelPickerShortcut } from '../shortcuts';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcuts', () => {
  it('opens the model picker on Cmd+K or Ctrl+K only', () => {
    expect(isModelPickerShortcut(key('k', { metaKey: true }))).toBe(true);
    expect(isModelPickerShortcut(key('K', { ctrlKey: true }))).toBe(true);
    expect(isModelPickerShortcut(key('k'))).toBe(false);
    expect(isModelPickerShortcut(key('k', { metaKey: true, shiftKey: true }))).toBe(false);
  });

  it('focuses the composer on / outside text fields only', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    expect(isFocusComposerShortcut(key('/'), div)).toBe(true);
    expect(isFocusComposerShortcut(key('/'), input)).toBe(false);
    expect(isFocusComposerShortcut(key('/'), textarea)).toBe(false);
    expect(isFocusComposerShortcut(key('/', { ctrlKey: true }), div)).toBe(false);
  });
});
