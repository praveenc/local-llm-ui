/**
 * SavePromptButton Component
 *
 * Chat input button that opens the "Save Prompt" dialog with the current input text.
 */
import { BookmarkPlus } from 'lucide-react';
import { toast } from 'sonner';

import { useState } from 'react';

import { usePromptMutations, useSavedPrompts } from '../../hooks';
import { PromptInputButton } from '../ai-elements/prompt-input';
import { SavePromptModal } from '../prompts/SavePromptModal';
import { composerIconButton } from './composerStyles';

interface SavePromptButtonProps {
  /** The text to save as a prompt */
  text: string;
  disabled?: boolean;
}

export function SavePromptButton({ text, disabled }: SavePromptButtonProps) {
  const [open, setOpen] = useState(false);
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
    <>
      <PromptInputButton
        className={composerIconButton}
        aria-label="Save prompt"
        title="Save prompt"
        disabled={disabled || !text.trim()}
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus className="size-4" />
      </PromptInputButton>
      <SavePromptModal
        visible={open}
        onDismiss={() => setOpen(false)}
        promptContent={text}
        existingCategories={categories}
        onSave={handleSave}
      />
    </>
  );
}
