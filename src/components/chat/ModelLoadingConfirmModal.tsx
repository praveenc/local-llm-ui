import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ModelLoadingConfirmModalProps {
  visible: boolean;
  modelName: string;
  modelArchitecture?: string;
  modelParams?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ModelLoadingConfirmModal({
  visible,
  modelName,
  modelArchitecture,
  modelParams,
  onConfirm,
  onCancel,
}: ModelLoadingConfirmModalProps) {
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/lmstudio_icon.svg" alt="LM Studio" className="w-6 h-6" />
            Load Model?
          </DialogTitle>
          <DialogDescription>
            Do you want to load <strong className="text-foreground">{modelName}</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {(modelArchitecture || modelParams) && (
            <div className="flex flex-col gap-2 text-sm">
              {modelArchitecture && (
                <div>
                  <span className="font-medium text-muted-foreground">Architecture:</span>{' '}
                  <span>{modelArchitecture}</span>
                </div>
              )}
              {modelParams && (
                <div>
                  <span className="font-medium text-muted-foreground">Parameters:</span>{' '}
                  <span>{modelParams}</span>
                </div>
              )}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            This may take 5-15 seconds depending on the model size. You'll see a progress bar during
            the loading process.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Load Model</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
