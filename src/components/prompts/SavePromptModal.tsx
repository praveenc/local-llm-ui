import { Loader2 } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface SavePromptModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSave: (name: string, category: string) => Promise<void>;
  promptContent: string;
  existingCategories?: string[];
}

export function SavePromptModal({
  visible,
  onDismiss,
  onSave,
  promptContent,
  existingCategories = [],
}: SavePromptModalProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError('Please enter a name for the prompt');
      return;
    }

    setIsSaving(true);
    try {
      const finalCategory = category.trim() || 'default';
      await onSave(name.trim(), finalCategory);
      handleClose();
    } catch {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setName('');
    setCategory('');
    setNameError('');
    onDismiss();
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Save Prompt</DialogTitle>
          <DialogDescription>Save this prompt for later use.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="prompt-name">Prompt Name</Label>
            <Input
              id="prompt-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError('');
              }}
              placeholder="Enter a name for this prompt"
              autoFocus
              className={cn(nameError && 'border-destructive')}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <p className="text-sm text-muted-foreground">
              Organize your prompts with a category (optional, defaults to 'default')
            </p>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Enter or select a category"
            />
            {existingCategories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {existingCategories.slice(0, 5).map((cat) => (
                  <Button
                    key={cat}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setCategory(cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Prompt Preview</Label>
            <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground max-h-[100px] overflow-auto whitespace-pre-wrap font-mono">
              {promptContent.length > 300 ? `${promptContent.slice(0, 300)}...` : promptContent}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
