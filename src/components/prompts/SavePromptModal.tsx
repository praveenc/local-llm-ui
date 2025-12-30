import { useState } from 'react';

import {
  Autosuggest,
  Box,
  Button,
  FormField,
  Input,
  Modal,
  SpaceBetween,
} from '@cloudscape-design/components';

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

  // Generate suggestions from existing categories
  const categoryOptions = existingCategories
    .filter((cat) => cat.toLowerCase().includes(category.toLowerCase()))
    .map((cat) => ({ value: cat }));

  return (
    <Modal
      visible={visible}
      onDismiss={handleClose}
      header="Save Prompt"
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={isSaving}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <FormField label="Prompt Name" errorText={nameError}>
          <Input
            value={name}
            onChange={({ detail }) => {
              setName(detail.value);
              setNameError('');
            }}
            placeholder="Enter a name for this prompt"
            autoFocus
          />
        </FormField>

        <FormField
          label="Category"
          description="Organize your prompts with a category (optional, defaults to 'default')"
        >
          <Autosuggest
            value={category}
            onChange={({ detail }) => setCategory(detail.value)}
            options={categoryOptions}
            placeholder="Enter or select a category"
            empty="No matching categories"
            enteredTextLabel={(value) => `Use: "${value}"`}
          />
        </FormField>

        <FormField label="Prompt Preview">
          <Box variant="code" padding="s" color="text-body-secondary" fontSize="body-s">
            <div style={{ maxHeight: '150px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {promptContent.length > 500 ? `${promptContent.slice(0, 500)}...` : promptContent}
            </div>
          </Box>
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
