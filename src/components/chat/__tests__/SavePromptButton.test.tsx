import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { promptsService } from '../../../services';
import { SavePromptButton } from '../SavePromptButton';

vi.mock('../../../services', () => ({
  promptsService: { savePrompt: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
};

const typeName = (name: string) => {
  fireEvent.change(screen.getByLabelText('Prompt Name'), { target: { value: name } });
};

describe('SavePromptButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(promptsService.savePrompt).mockResolvedValue('prompt-id');
  });

  it('is disabled when the text is blank', () => {
    render(<SavePromptButton text="   " />);
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<SavePromptButton text="Hello" disabled />);
    expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
  });

  it('opens the Save Prompt dialog', () => {
    render(<SavePromptButton text="Hello" />);
    openDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Save Prompt' })).toBeInTheDocument();
  });

  it('saves the text under the typed name and shows a toast', async () => {
    render(<SavePromptButton text="Summarize this" />);
    openDialog();
    typeName('Summary');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Prompt saved'));
    expect(promptsService.savePrompt).toHaveBeenCalledWith({
      name: 'Summary',
      content: 'Summarize this',
      category: 'default',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows an error toast and keeps the dialog open when saving fails', async () => {
    vi.mocked(promptsService.savePrompt).mockRejectedValue(new Error('disk full'));
    render(<SavePromptButton text="Summarize this" />);
    openDialog();
    typeName('Summary');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('disk full'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
