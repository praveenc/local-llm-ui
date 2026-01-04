import { Loader2 } from 'lucide-react';

import { useMemo, useState } from 'react';

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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const [categoryOpen, setCategoryOpen] = useState(false);

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

  // Filter categories based on input
  const filteredCategories = useMemo(() => {
    if (!category) return existingCategories;
    return existingCategories.filter((cat) => cat.toLowerCase().includes(category.toLowerCase()));
  }, [category, existingCategories]);

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
            <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
              <PopoverTrigger asChild>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Enter or select a category"
                  onFocus={() => setCategoryOpen(true)}
                />
              </PopoverTrigger>
              <PopoverContent
                className="w-[300px] p-0"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <ScrollArea className="h-[200px]">
                  {filteredCategories.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                      {category ? `Press Enter to use "${category}"` : 'No existing categories'}
                    </div>
                  ) : (
                    <div className="p-1">
                      {filteredCategories.map((cat) => (
                        <button
                          key={cat}
                          className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                          onClick={() => {
                            setCategory(cat);
                            setCategoryOpen(false);
                          }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
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
