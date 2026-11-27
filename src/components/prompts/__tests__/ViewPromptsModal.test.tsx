import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// The mocked hook reads this state, so a test can change the list (a delete) and rerender
const state = vi.hoisted(() => ({ prompts: [] as SavedPrompt[] }));
const deletePrompt = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks', () => ({
  useSavedPrompts: () => ({
    prompts: state.prompts,
    categories: ['Coding', 'Writing'],
    isLoading: false,
  }),
}));

vi.mock('../../../services', () => ({
  promptsService: { deletePrompt },
}));

beforeEach(() => {
  state.prompts = prompts;
  deletePrompt.mockReset();
});

const setup = (withInsert = true) => {
  const onDismiss = vi.fn();
  const onInsertPrompt = vi.fn();
  // A new element on each call, so that a rerender is not skipped for an equal element
  const ui = () => (
    <ViewPromptsModal
      visible
      onDismiss={onDismiss}
      onInsertPrompt={withInsert ? onInsertPrompt : undefined}
    />
  );
  const { rerender } = render(ui());
  return { onDismiss, onInsertPrompt, rerender: () => rerender(ui()) };
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

describe('ViewPromptsModal empty state', () => {
  it('tells you to save a prompt from the + menu, not with a bookmark button', () => {
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no prompt has this' } });
    expect(screen.getByText('No saved prompts')).toBeInTheDocument();
    expect(
      screen.getByText('Type a prompt in the chat input, click +, and then click Save as prompt.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/bookmark/i)).not.toBeInTheDocument();
  });
});

const manyPrompts = (count: number): SavedPrompt[] =>
  Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2025, 0, 1) + (count - i) * 86_400_000);
    return {
      id: `m${i}`,
      name: `Prompt ${String(i).padStart(2, '0')}`,
      content: `Content ${i}`,
      category: 'Writing',
      createdAt: day,
      updatedAt: day,
    };
  });

/**
 * Put the focus on the last control before the pager, so that one Tab goes to Previous. The
 * dialog moves the focus to its first field after it opens, so wait for that first.
 */
const focusBeforePager = async () => {
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
  const rows = screen.getAllByRole('row');
  within(rows[rows.length - 1])
    .getByRole('button', { name: 'Delete prompt' })
    .focus();
};

describe('ViewPromptsModal pager', () => {
  beforeEach(() => {
    state.prompts = manyPrompts(25);
  });

  it('renders each page control as a button, with the current page marked', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'pagination' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Go to previous page',
      'Page 1',
      'Page 2',
      'Page 3',
      'Go to next page',
    ]);
    for (const button of buttons) expect(button).toHaveAttribute('type', 'button');
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 2' })).not.toHaveAttribute('aria-current');
  });

  it('reaches Previous, each page, and Next with Tab', async () => {
    const user = userEvent.setup();
    setup();
    await focusBeforePager();
    for (const name of ['Go to previous page', 'Page 1', 'Page 2', 'Page 3', 'Go to next page']) {
      await user.tab();
      expect(screen.getByRole('button', { name })).toHaveFocus();
    }
  });

  it('changes the page with Enter and with Space, and marks the current page', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByText('Prompt 00')).toBeInTheDocument();
    await focusBeforePager();
    await user.tab(); // Previous
    await user.tab(); // Page 1
    await user.tab(); // Page 2
    await user.keyboard('{Enter}');
    expect(screen.getByText('Prompt 10')).toBeInTheDocument();
    expect(screen.queryByText('Prompt 00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 1' })).not.toHaveAttribute('aria-current');

    await user.tab(); // Page 3
    await user.keyboard(' ');
    expect(screen.getByText('Prompt 20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Previous and Next in the tab order and inert at the limits', async () => {
    const user = userEvent.setup();
    setup();
    const previous = screen.getByRole('button', { name: 'Go to previous page' });
    const next = screen.getByRole('button', { name: 'Go to next page' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).not.toBeDisabled();
    expect(next).not.toHaveAttribute('aria-disabled', 'true');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    previous.focus();
    await user.keyboard('{Enter}');
    expect(previous).toHaveFocus();
    expect(screen.getByText('Prompt 00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(screen.getByText('Prompt 20')).toBeInTheDocument();
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toBeDisabled();
    expect(previous).not.toHaveAttribute('aria-disabled', 'true');
    next.focus();
    await user.keyboard('{Enter}');
    await user.click(next);
    expect(next).toHaveFocus();
    expect(screen.getByText('Prompt 20')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Page 3 of 3');
  });

  it('says the page in words and updates it when the page changes', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Page 1 of 3');
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(screen.getByRole('status')).toHaveTextContent('Page 2 of 3');
  });

  it('gives each page control a 44 px target on a coarse pointer', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'pagination' });
    for (const button of within(nav).getAllByRole('button')) {
      expect(button).toHaveClass('pointer-coarse:min-h-11', 'pointer-coarse:min-w-11');
    }
  });

  it('shows no pager for one page', () => {
    state.prompts = manyPrompts(10);
    setup();
    expect(screen.queryByRole('navigation', { name: 'pagination' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the page before when the last prompt on the last page is deleted', async () => {
    const user = userEvent.setup();
    state.prompts = manyPrompts(11);
    deletePrompt.mockImplementation(async (id: string) => {
      state.prompts = state.prompts.filter((p) => p.id !== id);
    });
    setup();
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    const row = screen.getByText('Prompt 10').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Delete prompt' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deletePrompt).toHaveBeenCalledWith('m10'));
    await waitFor(() => expect(screen.getByText('Prompt 00')).toBeInTheDocument());
    expect(screen.queryByText('No saved prompts')).not.toBeInTheDocument();
    expect(screen.getByText('Prompt 09')).toBeInTheDocument();
  });

  it('stays on the page before when the list grows again after the clamp', async () => {
    const user = userEvent.setup();
    state.prompts = manyPrompts(11);
    deletePrompt.mockImplementation(async (id: string) => {
      state.prompts = state.prompts.filter((p) => p.id !== id);
    });
    const { rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    const row = screen.getByText('Prompt 10').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Delete prompt' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText('Prompt 00')).toBeInTheDocument());

    // A live query (for example from another tab) adds prompts again: no jump to page 2
    state.prompts = manyPrompts(25);
    rerender();
    expect(screen.getByText('Prompt 00')).toBeInTheDocument();
    expect(screen.queryByText('Prompt 10')).not.toBeInTheDocument();
    // Radix drops the aria-hidden of the closed confirm dialog a moment later
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    );
    expect(screen.getByRole('status')).toHaveTextContent('Page 1 of 3');
  });

  it('scrolls the table to the top when the page changes', async () => {
    const user = userEvent.setup();
    setup();
    const container = document.querySelector<HTMLElement>('.flex-1.overflow-auto')!;
    expect(container).not.toBeNull();
    let scrollTop = 120;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(scrollTop).toBe(0);

    scrollTop = 80;
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(scrollTop).toBe(0);
  });

  it('keeps the text colour of a disabled control on hover', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toHaveClass(
      'aria-disabled:hover:text-inherit'
    );
  });
});
