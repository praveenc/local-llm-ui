/**
 * Confirmation modal for prompt optimization
 */
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface OptimizePromptModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  isOptimizing: boolean;
}

const OptimizePromptModal = ({
  visible,
  onDismiss,
  onConfirm,
  isOptimizing,
}: OptimizePromptModalProps) => {
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Optimize Prompt</DialogTitle>
          <DialogDescription>
            Your prompt will be sent to <strong>Claude Opus 4.5</strong> for optimization using
            prompting best practices.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-sm text-muted-foreground">
            The optimization process analyzes your prompt and rewrites it to be more effective with
            Claude 4.5 models, following Anthropic&apos;s recommended prompting techniques.
          </p>
          <p className="text-sm text-blue-600 dark:text-blue-400">
            This will replace your current prompt with the optimized version. You can undo this
            change after optimization.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onDismiss} disabled={isOptimizing}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isOptimizing}>
            {isOptimizing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Optimizing...
              </span>
            ) : (
              'Optimize'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OptimizePromptModal;
