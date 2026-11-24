import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationList } from '../ConversationList';

const updateConversationTitle = vi.fn();
const onSelectConversation = vi.fn();

vi.mock('../../../hooks', () => ({
  useConversations: () => ({
    conversations: [
      { id: 'c1', title: 'Old title', messageCount: 0, updatedAt: new Date() },
      {
        id: 'c2',
        title: 'A conversation title that is much longer than twenty five characters',
        messageCount: 0,
        updatedAt: new Date(),
      },
    ],
    isLoading: false,
  }),
  useConversationMutations: () => ({ deleteConversation: vi.fn(), updateConversationTitle }),
}));

const renderList = (activeConversationId: string | null = null) =>
  render(
    <ConversationList
      activeConversationId={activeConversationId}
      onSelectConversation={onSelectConversation}
      onNewChat={vi.fn()}
    />
  );

const startRename = async () => {
  const user = userEvent.setup();
  renderList();
  await user.click(screen.getByRole('button', { name: 'Options for Old title' }));
  await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
  const input = screen.getByDisplayValue('Old title');
  await user.clear(input);
  await user.type(input, '日本語');
  return input;
};

beforeEach(() => {
  updateConversationTitle.mockClear();
  onSelectConversation.mockClear();
});

describe('ConversationList keyboard access', () => {
  it('opens a conversation from the keyboard', async () => {
    const user = userEvent.setup();
    renderList();
    screen.getByRole('button', { name: 'Old title' }).focus();
    await user.keyboard('{Enter}');
    expect(onSelectConversation).toHaveBeenCalledWith('c1');
  });

  it('marks the open conversation as the current page', () => {
    renderList('c1');
    expect(screen.getByRole('button', { name: 'Old title' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('names each options button after its conversation', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Options for Old title' })).toBeInTheDocument();
  });

  it('keeps the full title for screen readers and find-in-page', () => {
    renderList();
    expect(
      screen.getByRole('button', {
        name: 'A conversation title that is much longer than twenty five characters',
      })
    ).toBeInTheDocument();
  });
});

describe('ConversationList rename with an IME', () => {
  it('ignores Enter that confirms an IME candidate', async () => {
    const input = await startRename();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
    );
    expect(updateConversationTitle).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('ignores Safari IME Enter (keyCode 229, isComposing already false)', async () => {
    const input = await startRename();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'keyCode', { value: 229 });
    input.dispatchEvent(event);
    expect(updateConversationTitle).not.toHaveBeenCalled();
  });

  it('saves on a plain Enter', async () => {
    await startRename();
    await userEvent.keyboard('{Enter}');
    expect(updateConversationTitle).toHaveBeenCalledWith('c1', '日本語');
  });
});

describe('ConversationList search', () => {
  it('shows only the chats whose title matches, case-insensitively', async () => {
    const user = userEvent.setup();
    renderList();
    await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'OLD');
    expect(screen.getByRole('button', { name: 'Old title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /much longer/ })).not.toBeInTheDocument();
  });

  it('says so when no chat matches, and Escape clears the search', async () => {
    const user = userEvent.setup();
    renderList();
    const search = screen.getByRole('searchbox', { name: 'Search chats' });
    await user.type(search, 'zebra');
    expect(screen.getByRole('status')).toHaveTextContent('No chats match “zebra”');
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Old title' })).toBeInTheDocument();
  });
});
