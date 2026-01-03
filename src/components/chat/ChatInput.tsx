import { Send } from 'lucide-react';

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  maxRows?: number;
  minRows?: number;
  secondaryActions?: ReactNode;
  className?: string;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
  loading = false,
  maxRows = 6,
  minRows = 1,
  secondaryActions,
  className,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Calculate line height (approximate)
    const lineHeight = 24; // ~1.5rem
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    // Set new height within bounds
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [maxRows, minRows]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !loading && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleSubmit = () => {
    if (!disabled && !loading && value.trim()) {
      onSubmit();
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          className={cn(
            'min-h-[40px] resize-none pr-12',
            'focus-visible:ring-1 focus-visible:ring-ring'
          )}
          rows={minRows}
        />
        <Button
          type="button"
          size="icon"
          onClick={handleSubmit}
          disabled={disabled || loading || !value.trim()}
          className="absolute right-2 bottom-2 h-8 w-8"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {secondaryActions && <div className="flex items-center gap-2">{secondaryActions}</div>}
    </div>
  );
}
