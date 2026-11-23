import { useState } from 'react';

/**
 * Keeps a dialog with unsaved edits open when the user presses Esc, clicks outside, or
 * clicks the close button, and asks once whether to discard them.
 *
 * Pass `onOpenChange` to the dialog root. While `asking` is true, render
 * <DiscardChangesNotice onDiscard={discard} />. Buttons that close on purpose (Save,
 * Cancel) keep calling their own close.
 */
export function useDiscardGuard({
  open,
  dirty,
  onClose,
}: {
  open: boolean;
  dirty: boolean;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);
  // Forget the question once the dialog is closed (adjusting state during render)
  if (!open && asking) setAsking(false);

  const onOpenChange = (next: boolean) => {
    if (next) return;
    if (dirty) {
      setAsking(true);
      return;
    }
    onClose();
  };

  const discard = () => {
    setAsking(false);
    onClose();
  };

  return { asking: asking && dirty, onOpenChange, discard };
}
