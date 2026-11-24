import { toast } from 'sonner';

import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { normalizeTitle } from '@/utils/conversationTitle';

/** How the edit ended: Enter and Esc come from the keyboard, blur from a click elsewhere */
export type TitleEditEnd = 'enter' | 'escape' | 'blur';

interface EditableTitleInputProps {
  /** The stored title; the field starts with it, selected */
  value: string;
  /** Called with a normalized title that differs from `value`; never with an empty one */
  onSave: (title: string) => Promise<void> | void;
  /** Called once when the edit ends, with or without a save. The parent closes the field. */
  onEnd: (reason: TitleEditEnd) => void;
  'aria-label': string;
  className?: string;
}

/**
 * Text field for renaming a chat. Enter and blur save, Esc cancels. An empty text or the
 * same title writes nothing. Enter that confirms an IME candidate does not save.
 */
export function EditableTitleInput({
  value,
  onSave,
  onEnd,
  'aria-label': ariaLabel,
  className,
}: EditableTitleInputProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // A save or cancel ends the edit once; the blur that follows the unmount must not save again
  const endedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const end = (reason: TitleEditEnd) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (reason !== 'escape') {
      const title = normalizeTitle(draft);
      if (title !== null && title !== value) {
        Promise.resolve(onSave(title)).catch(() => toast.error('Could not rename the chat'));
      }
    }
    onEnd(reason);
  };

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => end('blur')}
      onKeyDown={(e) => {
        // keyCode 229 covers Safari, which clears isComposing before this keydown
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          end('enter');
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          end('escape');
        }
      }}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
