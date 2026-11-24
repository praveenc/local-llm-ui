/**
 * SavePromptDialog
 *
 * The "Save Prompt" dialog for the text in the chat input. The "Save as prompt" item in the
 * chat input's + menu opens it.
 */
import { toast } from 'sonner';

import { usePromptMutations, useSavedPrompts } from '../../hooks';
import { SavePromptModal } from '../prompts/SavePromptModal';

interface SavePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The text to save as a prompt */
  text: string;
}

export function SavePromptDialog({ open, onOpenChange, text }: SavePromptDialogProps) {
  const { categories } = useSavedPrompts();
  const { savePrompt } = usePromptMutations();

  const handleSave = async (name: string, category: string) => {
    try {
      await savePrompt(name, text, category);
      toast.success('Prompt saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompt');
      // The modal stays open when onSave throws
      throw err;
    }
  };

  return (
    <SavePromptModal
      visible={open}
      onDismiss={() => onOpenChange(false)}
      promptContent={text}
      existingCategories={categories}
      onSave={handleSave}
    />
  );
}
