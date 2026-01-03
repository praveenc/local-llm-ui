import ReactMarkdown from 'react-markdown';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { SavedPrompt } from '../../db';
import { CopyToClipboard } from '../shared';

interface ViewPromptDetailModalProps {
  visible: boolean;
  onDismiss: () => void;
  prompt: SavedPrompt | null;
}

export function ViewPromptDetailModal({ visible, onDismiss, prompt }: ViewPromptDetailModalProps) {
  if (!prompt) return null;

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{prompt.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground">Category:</span>
            <span>{prompt.category}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground">Created:</span>
            <span>{prompt.createdAt.toLocaleDateString()}</span>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Prompt Content:</span>
            <div className="rounded-md border bg-muted/50 p-4 text-sm max-h-[400px] overflow-auto">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{prompt.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <CopyToClipboard text={prompt.content} variant="outline" size="default" />
          <Button onClick={onDismiss}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
