import { Loader2 } from 'lucide-react';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ModelLoadingProgressProps {
  visible: boolean;
  modelName: string;
  onCancel: () => void;
}

export default function ModelLoadingProgress({
  visible,
  modelName,
  onCancel,
}: ModelLoadingProgressProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!visible) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [visible]);

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/lmstudio_icon.svg" alt="LM Studio" className="w-6 h-6" />
            Loading Model
          </DialogTitle>
          <DialogDescription>Please wait while the model loads...</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-6">
          <h3 className="text-lg font-semibold">{modelName}</h3>
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Elapsed time: {elapsedTime}s</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
