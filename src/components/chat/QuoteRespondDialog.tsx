/**
 * Quote and Ask dialog
 *
 * Shows the quoted text and a response box. The user can put the quote and
 * response into the compose box, or fork the conversation and send it there.
 */
import { GitFork, Quote, Send } from 'lucide-react';

import { useState } from 'react';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface QuoteRespondDialogProps {
  /** Quoted text; the dialog is open when this is set */
  quote: string | null;
  onClose: () => void;
  onSendToCompose: (response: string) => void;
  onSendToFork: (response: string) => void;
  /** Reason fork is not available (shown as tooltip); fork is enabled when undefined */
  forkDisabledReason?: string;
}

export const QuoteRespondDialog = ({
  quote,
  onClose,
  onSendToCompose,
  onSendToFork,
  forkDisabledReason,
}: QuoteRespondDialogProps) => {
  const [response, setResponse] = useState('');
  const hasResponse = response.trim().length > 0;

  const close = () => {
    setResponse('');
    onClose();
  };

  const sendToCompose = () => {
    onSendToCompose(response);
    setResponse('');
  };

  const sendToFork = () => {
    if (!hasResponse || forkDisabledReason) return;
    onSendToFork(response);
    setResponse('');
  };

  return (
    <DialogPrimitive.Root open={quote !== null} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        {/* Above the prompt input and other dialogs (z-50) */}
        <DialogOverlay className="z-[1100] bg-black/30" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-[1100] flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg outline-none sm:max-w-xl"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold text-primary">
            <Quote className="h-4 w-4" />
            Quote and Ask
          </DialogPrimitive.Title>

          <blockquote
            data-testid="quote-preview"
            className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border-l-4 border-primary/40 bg-muted px-3 py-2 text-sm text-muted-foreground"
          >
            {quote}
          </blockquote>

          <Textarea
            autoFocus
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendToCompose();
              }
            }}
            placeholder="Your response..."
            className="min-h-24 max-h-60"
          />

          {forkDisabledReason && (
            <p
              className="text-xs text-muted-foreground text-right"
              data-testid="fork-disabled-reason"
            >
              Send to Fork is not available: {forkDisabledReason}.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={sendToCompose}
              title="Put the quote and response in the message box (Ctrl/⌘ + Enter)"
            >
              <Send className="h-4 w-4" />
              Send to Compose
            </Button>
            <Button
              onClick={sendToFork}
              disabled={!hasResponse || Boolean(forkDisabledReason)}
              title={
                forkDisabledReason ??
                'Copy the conversation up to this message into a new conversation and send there'
              }
            >
              <GitFork className="h-4 w-4" />
              Send to Fork
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
};
