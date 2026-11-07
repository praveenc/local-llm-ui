/**
 * Floating "Quote and Ask" button that appears next to text selected inside a chat message.
 */
import { Quote } from 'lucide-react';

import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';

export interface QuoteSelection {
  text: string;
  /** Index of the last message the selection touches */
  messageIndex: number;
}

interface SelectionState extends QuoteSelection {
  top: number;
  left: number;
}

/** Find the message index for a DOM node inside an element with data-message-index */
function getMessageIndex(node: Node | null, container: HTMLElement): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const messageElement = element?.closest<HTMLElement>('[data-message-index]');
  if (!messageElement || !container.contains(messageElement)) return null;
  const index = Number(messageElement.dataset.messageIndex);
  return Number.isInteger(index) ? index : null;
}

interface QuoteSelectionButtonProps {
  containerRef: RefObject<HTMLElement | null>;
  onQuote: (selection: QuoteSelection) => void;
  disabled?: boolean;
}

export const QuoteSelectionButton = ({
  containerRef,
  onQuote,
  disabled,
}: QuoteSelectionButtonProps) => {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const readSelection = useCallback(() => {
    const container = containerRef.current;
    const domSelection = window.getSelection();
    if (!container || !domSelection || domSelection.isCollapsed || domSelection.rangeCount === 0) {
      setSelection(null);
      return;
    }

    const text = domSelection.toString().trim();
    const anchorIndex = getMessageIndex(domSelection.anchorNode, container);
    const focusIndex = getMessageIndex(domSelection.focusNode, container);
    if (!text || anchorIndex === null || focusIndex === null) {
      setSelection(null);
      return;
    }

    const rect = domSelection.getRangeAt(0).getBoundingClientRect();
    setSelection({
      text,
      messageIndex: Math.max(anchorIndex, focusIndex),
      top: Math.max(8, rect.top - 40),
      left: rect.left + rect.width / 2,
    });
  }, [containerRef]);

  useEffect(() => {
    // Listen on the document, not the container: the container does not exist
    // yet when the chat is empty, and readSelection checks it at event time.
    // Show the button only after the user finishes selecting
    const handlePointerUp = () => requestAnimationFrame(readSelection);
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') readSelection();
    };
    // Hide the button as soon as the selection goes away
    const handleSelectionChange = () => {
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.isCollapsed) setSelection(null);
    };
    const hide = () => setSelection(null);

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [readSelection]);

  if (!selection || disabled) return null;

  return createPortal(
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="fixed z-[1050] -translate-x-1/2 gap-1.5 shadow-md border border-border"
      style={{ top: selection.top, left: selection.left }}
      // Keep the text selection while clicking
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote({ text: selection.text, messageIndex: selection.messageIndex });
        window.getSelection()?.removeAllRanges();
        setSelection(null);
      }}
    >
      <Quote className="h-3.5 w-3.5" />
      Quote and Ask
    </Button>,
    document.body
  );
};
