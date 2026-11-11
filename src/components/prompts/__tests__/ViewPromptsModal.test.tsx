import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedPrompt } from '../../../db';
import { ViewPromptsModal } from '../ViewPromptsModal';

const prompts: SavedPrompt[] = [
  {
    id: 'p1',
    name: 'Summarize',
    content: 'Summarize this text in three bullets.',
    category: 'Writing',
    createdAt: new Date('2025-01-02'),
    updatedAt: new Date('2025-01-02'),
  },
  {
    id: 'p2',
    name: 'Review code',
    content: 'Review this code for bugs.',
    category: 'Coding',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
];

vi.mock('../../../hooks', () => ({
  useSavedPrompts: () => ({
    prompts,
    categories: ['Coding', 'Writing'],
    isLoading: false,
  }),
}));

vi.mock('../../../services', () => ({
  promptsService: { deletePrompt: vi.fn() },
}));

const setup = (withInsert = true) => {
  const onDismiss = vi.fn();
  const onInsertPrompt = vi.fn();
  render(
    <ViewPromptsModal
      visible
      onDismiss={onDismiss}
      onInsertPrompt={withInsert ? onInsertPrompt : undefined}
    />
  );
  return { onDismiss, onInsertPrompt };
};

describe('ViewPromptsModal Insert action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an Insert button in every row when onInsertPrompt is set', () => {
    setup();
    expect(screen.getAllByRole('button', { name: 'Insert into chat' })).toHaveLength(
      prompts.length
    );
  });

  it('inserts the prompt of the clicked row and dismisses the dialog', () => {
    const { onInsertPrompt, onDismiss } = setup();
    const row = screen.getByText('Review code').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Insert into chat' }));
    expect(onInsertPrompt).toHaveBeenCalledTimes(1);
    expect(onInsertPrompt).toHaveBeenCalledWith('Review this code for bugs.');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders no Insert button without onInsertPrompt', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'Insert into chat' })).not.toBeInTheDocument();
  });

  it('offers Insert in the detail dialog and inserts the selected prompt', () => {
    const { onInsertPrompt, onDismiss } = setup();
    const row = screen.getByText('Summarize').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'View prompt' }));
    const detail = screen.getByRole('dialog', { name: 'Summarize' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Insert into chat' }));
    expect(onInsertPrompt).toHaveBeenCalledWith('Summarize this text in three bullets.');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
