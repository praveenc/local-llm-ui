import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseKiroSessionsResult } from '../../../hooks/useKiroSessions';
import { Sidebar } from '../Sidebar';

const SESSION = 'sess_00000000-0000-4000-8000-000000000001';

vi.mock('../../../hooks', () => ({
  useConversations: () => ({
    conversations: [
      { id: 'c1', title: 'Deploy the app', messageCount: 2, updatedAt: new Date() },
      { id: 'c2', title: 'Lunch ideas', messageCount: 2, updatedAt: new Date() },
    ],
    isLoading: false,
  }),
  useConversationMutations: () => ({
    deleteConversation: vi.fn(),
    updateConversationTitle: vi.fn(),
  }),
}));

vi.mock('../../prompts', () => ({ ViewPromptsModal: () => null }));

const removeOpener = vi.hoisted(() => vi.fn());
const setReplyOpener = vi.hoisted(() =>
  vi.fn<(open: (id: string) => void) => () => void>(() => removeOpener)
);
vi.mock('../../../services/replyNotices', () => ({ setReplyOpener }));

const kiro = vi.hoisted(() => ({ value: undefined as unknown as UseKiroSessionsResult }));
vi.mock('../../../hooks/useKiroSessions', () => ({ useKiroSessions: () => kiro.value }));

beforeEach(() => {
  localStorage.clear();
  kiro.value = {
    enabled: true,
    sessions: [
      {
        sessionId: SESSION,
        title: 'Deploy from the terminal',
        folder: 'cwd',
        updatedAt: new Date().toISOString(),
        status: 'idle',
      },
    ],
    listError: false,
    days: 7,
    setDays: vi.fn(),
    refresh: vi.fn(),
    rows: {},
    notice: null,
    importSession: vi.fn(async () => {}),
    syncIfNewer: vi.fn(),
  };
});

const renderSidebar = (onSelectConversation = vi.fn()) =>
  render(
    <Sidebar
      onNewChat={vi.fn()}
      activeConversationId={null}
      onSelectConversation={onSelectConversation}
    />
  );

describe('Sidebar', () => {
  it('shows the Kiro sessions section under Conversations when it is on', () => {
    renderSidebar();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Conversations', 'Kiro sessions']);
    expect(screen.getByRole('navigation', { name: 'Kiro sessions' })).toBeInTheDocument();
  });

  it('hides the section when Kiro is signed out or the switch is off', () => {
    kiro.value = { ...kiro.value, enabled: false };
    renderSidebar();
    expect(screen.queryByRole('heading', { name: 'Kiro sessions' })).not.toBeInTheDocument();
  });

  it('filters both sections with one Search chats field', async () => {
    renderSidebar();
    expect(screen.getAllByRole('searchbox', { name: 'Search chats' })).toHaveLength(1);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'deploy');
    expect(screen.getByRole('button', { name: 'Deploy the app' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lunch ideas' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Deploy from the terminal/ })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search chats' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'lunch');
    expect(screen.getByRole('button', { name: 'Lunch ideas' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Deploy from the terminal/ })
    ).not.toBeInTheDocument();
  });

  it('opens a conversation and then adds the turns that Kiro made since', async () => {
    const onSelect = vi.fn();
    renderSidebar(onSelect);
    await userEvent.click(screen.getByRole('button', { name: 'Deploy the app' }));
    expect(onSelect).toHaveBeenCalledWith('c1');
    expect(kiro.value.syncIfNewer).toHaveBeenCalledWith('c1');
  });

  it('opens the chat of a reply toast as a click on its row does, until it unmounts', () => {
    const onSelect = vi.fn();
    const { unmount } = renderSidebar(onSelect);
    const open = setReplyOpener.mock.calls.at(-1)![0];
    open('c2');
    expect(onSelect).toHaveBeenCalledWith('c2');
    expect(kiro.value.syncIfNewer).toHaveBeenCalledWith('c2');
    unmount();
    expect(removeOpener).toHaveBeenCalled();
  });
});
