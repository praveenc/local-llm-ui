import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, useState } from 'react';

import { GROUP_STATE_STORAGE_KEY } from '../../../utils/conversationGroups';
import { type ReplyRun, replyStore } from '../../../utils/replyStore';
import { ConversationList } from '../ConversationList';
import { ChatSearchInput } from '../sidebarParts';

const updateConversationTitle = vi.fn();
const deleteConversation = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>(async () => {}));
const onSelectConversation = vi.fn();

vi.mock('../../../hooks', () => ({
  useConversations: () => ({
    conversations: mockConversations(),
    isLoading: false,
  }),
  useConversationMutations: () => ({ deleteConversation, updateConversationTitle }),
}));

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

function mockConversations() {
  return [
    { id: 'c1', title: 'Old title', messageCount: 0, updatedAt: new Date() },
    {
      id: 'c2',
      title: 'A conversation title that is much longer than twenty five characters',
      messageCount: 0,
      updatedAt: new Date(),
    },
    { id: 'c3', title: 'Plan the trip', messageCount: 0, updatedAt: daysAgo(20) },
    { id: 'c4', title: 'Ancient chat', messageCount: 0, updatedAt: daysAgo(400) },
    { id: 'c5', title: 'Another ancient chat', messageCount: 0, updatedAt: daysAgo(400) },
  ];
}

/** The list with the Search chats field, as the Sidebar renders them */
function ListWithSearch({ activeConversationId }: { activeConversationId: string | null }) {
  const [query, setQuery] = useState('');
  return (
    <>
      <ChatSearchInput value={query} onChange={setQuery} />
      <ConversationList
        query={query}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
        onNewChat={vi.fn()}
      />
    </>
  );
}

const renderList = (activeConversationId: string | null = null) =>
  render(<ListWithSearch activeConversationId={activeConversationId} />);

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
  localStorage.clear();
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

describe('ConversationList rename rules', () => {
  const openRename = async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Options for Old title' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    return { user, input: screen.getByDisplayValue('Old title') };
  };

  it('saves the trimmed text with collapsed spaces', async () => {
    const { user, input } = await openRename();
    await user.clear(input);
    await user.type(input, '  New   name  {Enter}');
    expect(updateConversationTitle).toHaveBeenCalledWith('c1', 'New name');
  });

  it('keeps the old title when the text is empty', async () => {
    const { user, input } = await openRename();
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(updateConversationTitle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Old title' })).toBeInTheDocument();
  });

  it('writes nothing when the title did not change, and Esc cancels', async () => {
    const { user, input } = await openRename();
    await user.type(input, '{Enter}');
    expect(updateConversationTitle).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Options for Old title' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    await user.keyboard('x{Escape}');
    expect(updateConversationTitle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Old title' })).toBeInTheDocument();
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

const groupButton = (name: RegExp) =>
  within(screen.getByRole('heading', { level: 3, name })).getByRole('button');

describe('ConversationList groups', () => {
  it('puts each group header button in an h3, with sentence-case labels', () => {
    renderList();
    expect(groupButton(/^Today$/)).toHaveAttribute('aria-expanded', 'true');
    expect(groupButton(/^Previous 30 days/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens Today by default and keeps older groups closed', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Old title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan the trip' })).not.toBeInTheDocument();
  });

  it('shows the number of chats only when a group is closed', () => {
    renderList();
    expect(groupButton(/^Today$/)).toHaveAccessibleName('Today');
    expect(groupButton(/^Previous 30 days/)).toHaveAccessibleName('Previous 30 days, 1 chat');
    const month = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => within(h).getByRole('button'))
      .find((b) => b.textContent?.endsWith('2'));
    expect(month).toHaveAccessibleName(/, 2 chats$/);
    expect(month?.textContent).not.toMatch(/[()]/);
  });

  it('remembers an opened group after a remount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderList();
    await user.click(groupButton(/^Previous 30 days/));
    await user.click(groupButton(/^Today$/));
    expect(groupButton(/^Previous 30 days/)).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem(GROUP_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      'previous-30-days': true,
      today: false,
    });
    unmount();
    renderList();
    expect(groupButton(/^Previous 30 days/)).toHaveAttribute('aria-expanded', 'true');
    expect(groupButton(/^Today/)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Plan the trip' })).toBeInTheDocument();
  });
});

describe('ConversationList rows', () => {
  it('shows the time of the last change with the full date in the tooltip', () => {
    renderList();
    const row = screen.getByRole('button', { name: 'Old title' }).parentElement as HTMLElement;
    const time = row.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(time?.textContent).toMatch(/\d{1,2}.\d{2}/);
    expect(time?.getAttribute('title')).toBeTruthy();
  });

  it('reaches the options button from the title with Tab', async () => {
    const user = userEvent.setup();
    renderList();
    screen.getByRole('button', { name: 'Old title' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Options for Old title' })).toHaveFocus();
  });

  it('hides the time while the row is renamed', async () => {
    await startRename();
    const input = screen.getByRole('textbox', { name: 'Conversation title' });
    expect(input.parentElement?.querySelector('time')).toBeNull();
  });
});

describe('ConversationList search and stored groups', () => {
  it('opens a closed group with a match and does not change the stored state', async () => {
    const user = userEvent.setup();
    renderList();
    await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'ancient');
    expect(screen.getByRole('button', { name: 'Ancient chat' })).toBeInTheDocument();
    const header = screen.getAllByRole('heading', { level: 3 });
    expect(header).toHaveLength(1);
    const button = within(header[0]).getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem(GROUP_STATE_STORAGE_KEY)).toBeNull();
  });
});

describe('ConversationList running replies', () => {
  it('says "Replying…" and "Waiting for your answer" in words on the running rows', () => {
    renderList();
    expect(screen.queryByText('Replying…')).not.toBeInTheDocument();
    let replying!: ReplyRun;
    act(() => {
      replying = replyStore.start('c1', []);
      replyStore.start('c2', []).update({ waiting: true });
    });

    const long = 'A conversation title that is much longer than twenty five characters';
    const row = (name: string) => screen.getByRole('button', { name }).parentElement!;
    expect(within(row('Old title')).getByText('Replying…')).toBeInTheDocument();
    expect(within(row(long)).getByText('Waiting for your answer')).toBeInTheDocument();
    // The spinner stops when reduced motion is on; the question icon does not spin
    expect(row('Old title').querySelector('svg')).toHaveClass('motion-reduce:animate-none');
    expect(row(long).querySelector('svg')).not.toHaveClass('animate-spin');
    expect(row('Old title').querySelector('time')).toBeNull();

    act(() => replying.end('stopped'));
    expect(within(row('Old title')).queryByText('Replying…')).not.toBeInTheDocument();
    expect(row('Old title').querySelector('time')).not.toBeNull();
  });

  it('stops a running reply and waits for its last write before the delete', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    deleteConversation.mockImplementation(async () => {
      order.push('delete');
    });
    // No component reads the store yet
    const run = replyStore.start('c1', []);
    run.signal.addEventListener('abort', () => {
      order.push('abort');
      // The run saves its last text, then finishes
      setTimeout(() => {
        order.push('finish');
        run.finish();
      }, 0);
    });
    renderList('c1');
    await user.click(screen.getByRole('button', { name: 'Options for Old title' }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('c1'));
    expect(order).toEqual(['abort', 'finish', 'delete']);
    expect(replyStore.get('c1')).toBeUndefined();
  });
});
