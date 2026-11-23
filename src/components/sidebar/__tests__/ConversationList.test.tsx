import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationList } from '../ConversationList';

const updateConversationTitle = vi.fn();

vi.mock('../../../hooks', () => ({
  useConversations: () => ({
    conversations: [{ id: 'c1', title: 'Old title', messageCount: 0, updatedAt: new Date() }],
    isLoading: false,
  }),
  useConversationMutations: () => ({ deleteConversation: vi.fn(), updateConversationTitle }),
}));

const startRename = async () => {
  const user = userEvent.setup();
  render(
    <ConversationList
      activeConversationId={null}
      onSelectConversation={vi.fn()}
      onNewChat={vi.fn()}
    />
  );
  const row = screen.getByTitle('Old title').parentElement!;
  await user.click(row.querySelector('button')!);
  await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
  const input = screen.getByDisplayValue('Old title');
  await user.clear(input);
  await user.type(input, '日本語');
  return input;
};

describe('ConversationList rename with an IME', () => {
  beforeEach(() => updateConversationTitle.mockClear());

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
