import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SavePromptModal } from '../SavePromptModal';

const renderModal = () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SavePromptModal visible onDismiss={vi.fn()} onSave={onSave} promptContent="Hello" />);
  return { onSave, name: screen.getByLabelText('Prompt Name') };
};

describe('SavePromptModal', () => {
  it('submits on Enter in Prompt Name', async () => {
    const { onSave, name } = renderModal();
    fireEvent.change(name, { target: { value: 'Greeting' } });
    fireEvent.submit(name.closest('form')!);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Greeting', 'default'));
  });

  it('marks an empty name invalid, describes it and focuses it', () => {
    const { onSave, name } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Please enter a name for the prompt');
    expect(name).toHaveFocus();
  });

  it('describes the category field with its hint', () => {
    renderModal();
    expect(screen.getByLabelText('Category')).toHaveAccessibleDescription(/Organize your prompts/);
  });
});
