import { useRef } from 'react';

/**
 * Focus handlers for Radix dialog and sheet content.
 *
 * Radix returns focus to its Trigger on close, and to nothing when the dialog was opened
 * from state (no Trigger), which drops keyboard users at the top of the page. These handlers
 * return focus to the element that opened the dialog, as a native <dialog> does.
 *
 * The opener is the focused element when the dialog opens. A dialog opened from a menu
 * item sees that item, which unmounts with the menu, so the menu's trigger (named by the
 * menu's aria-labelledby) stands in for it.
 * A caller's own handler runs first and can preventDefault to take over.
 */
const openerOf = (active: Element | null): HTMLElement | null => {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const menu = active.closest('[role="menu"]');
  const trigger = menu && document.getElementById(menu.getAttribute('aria-labelledby') ?? '');
  return trigger ?? active;
};

export function useRestoreFocus(
  onOpenAutoFocus?: (event: Event) => void,
  onCloseAutoFocus?: (event: Event) => void
) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      // Radix fires this before it moves focus, so activeElement is still the opener
      opener.current = openerOf(document.activeElement);
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const element = opener.current;
      opener.current = null;
      if (event.defaultPrevented) return;
      // Code already moved focus on purpose, such as a setTimeout(0) focus of the chat input
      // after an insert; Radix runs this a frame later, so the move has happened. Keep it.
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('[role="dialog"]')) {
        event.preventDefault();
        return;
      }
      if (element?.isConnected) {
        event.preventDefault();
        element.focus();
        return;
      }
      // The opener is gone (its row was deleted): stay inside a dialog that is still open
      const openDialog = [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]'),
      ].at(-1);
      if (openDialog) {
        event.preventDefault();
        openDialog.focus();
      }
    },
  };
}
