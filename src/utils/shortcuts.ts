/**
 * App keyboard shortcuts: Cmd/Ctrl+K opens the model picker and / focuses the message box.
 * Cmd/Ctrl+L (address bar) and Cmd/Ctrl+Shift+O (bookmarks) are browser keys, so they are not
 * used.
 */

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Cmd+K on macOS, Ctrl+K elsewhere; either one is accepted */
export const isModelPickerShortcut = (e: KeyLike): boolean =>
  e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

/** A bare "/" outside any text field */
export const isFocusComposerShortcut = (e: KeyLike, target: EventTarget | null): boolean =>
  e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditableTarget(target);

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

export const modelPickerShortcutLabel = (): string => (isMac() ? '⌘K' : 'Ctrl+K');
