import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useState } from 'react';

import { promptsService } from '../../../services';
import { SavePromptDialog } from '../SavePromptDialog';

vi.mock('../../../services', () => ({
  promptsService: { savePrompt: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/** The dialog as the chat input opens it: open, closed by the dialog itself */
function Harness({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return <SavePromptDialog open={open} onOpenChange={setOpen} text={text} />;
}

const typeName = (name: string) => {
  fireEvent.change(screen.getByLabelText('Prompt Name'), { target: { value: name } });
};

describe('SavePromptDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(promptsService.savePrompt).mockResolvedValue('prompt-id');
  });

  it('shows the Save Prompt dialog when it is open, and nothing when it is closed', () => {
    const { rerender } = render(<SavePromptDialog open onOpenChange={vi.fn()} text="Hello" />);
    expect(screen.getByRole('heading', { name: 'Save Prompt' })).toBeInTheDocument();
    rerender(<SavePromptDialog open={false} onOpenChange={vi.fn()} text="Hello" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves the text under the typed name, shows a toast, and closes', async () => {
    render(<Harness text="Summarize this" />);
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
    render(<Harness text="Summarize this" />);
    typeName('Summary');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('disk full'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
