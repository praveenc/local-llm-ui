import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseKiroSessionsResult } from '../../../hooks/useKiroSessions';
import { KIRO_GROUP_STATE_STORAGE_KEY } from '../../../utils/conversationGroups';
import type { KiroSessionSummary } from '../../../utils/kiroSessions';
import { KiroSessionList } from '../KiroSessionList';

const id = (n: number) => `sess_00000000-0000-4000-8000-00000000000${n}`;

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

const sessions: KiroSessionSummary[] = [
  {
    sessionId: id(1),
    title: 'Fix the build',
    folder: 'cwd',
    updatedAt: daysAgo(0),
    status: 'idle',
  },
  {
    sessionId: id(2),
    title: 'Write the release notes',
    folder: 'docs',
    updatedAt: daysAgo(0),
    status: 'in_progress',
  },
  {
    sessionId: id(3),
    title: 'Plan the trip',
    folder: 'home',
    updatedAt: daysAgo(3),
    status: 'failed',
  },
  { sessionId: id(4), title: 'Old work', folder: 'repo', updatedAt: daysAgo(20), status: 'idle' },
];

const kiro = (over: Partial<UseKiroSessionsResult> = {}): UseKiroSessionsResult => ({
  enabled: true,
  sessions,
  listError: false,
  days: 7,
  setDays: vi.fn(),
  refresh: vi.fn(),
  rows: {},
  notice: null,
  importSession: vi.fn(async () => {}),
  syncIfNewer: vi.fn(),
  ...over,
});

const row = (title: string) => screen.getByRole('button', { name: new RegExp(title) });

beforeEach(() => localStorage.clear());

describe('KiroSessionList', () => {
  it('shows the sessions in date groups, with the folder name and the time', () => {
    render(<KiroSessionList query="" kiro={kiro()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Kiro sessions' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Kiro sessions' });
    const groups = within(nav).getAllByRole('heading', { level: 3 });
    // A closed group shows its count
    expect(groups.map((g) => g.textContent)).toEqual([
      'Today',
      'Previous 7 days',
      'Previous 30 days1',
    ]);
    expect(
      within(groups[2]).getByRole('button', { name: 'Previous 30 days, 1 session' })
    ).toBeInTheDocument();
    expect(row('Fix the build')).toHaveTextContent('cwd');
    expect(row('Fix the build').closest('div')?.querySelector('time')).not.toBeNull();
  });

  it("shows Kiro's status in words when the session is not idle", () => {
    render(<KiroSessionList query="" kiro={kiro()} />);
    expect(row('Write the release notes')).toHaveTextContent('in progress');
    expect(row('Plan the trip')).toHaveTextContent('failed');
    expect(row('Fix the build')).not.toHaveTextContent('idle');
  });

  it('keeps its own open groups, apart from Conversations', async () => {
    render(<KiroSessionList query="" kiro={kiro()} />);
    const older = within(screen.getByRole('heading', { level: 3, name: /Previous 30 days/ }));
    expect(older.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(older.getByRole('button'));
    expect(JSON.parse(localStorage.getItem(KIRO_GROUP_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      'previous-30-days': true,
    });
    expect(screen.getByRole('button', { name: /Old work/ })).toBeInTheDocument();
  });

  it('filters by the search text and opens the groups with a match', () => {
    render(<KiroSessionList query="OLD" kiro={kiro()} />);
    expect(screen.getByRole('button', { name: /Old work/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fix the build/ })).not.toBeInTheDocument();
  });

  it('says so when no session matches the search', () => {
    render(<KiroSessionList query="zebra" kiro={kiro()} />);
    expect(screen.getByText('No Kiro sessions match “zebra”')).toBeInTheDocument();
  });

  it('imports a session on a click', async () => {
    const state = kiro();
    render(<KiroSessionList query="" kiro={state} />);
    await userEvent.click(row('Fix the build'));
    expect(state.importSession).toHaveBeenCalledWith(id(1));
  });

  it('shows Importing… while a row loads, and its error in words', () => {
    render(
      <KiroSessionList
        query=""
        kiro={kiro({
          rows: {
            [id(1)]: { importing: true },
            [id(3)]: { error: 'Kiro could not open this session.' },
          },
        })}
      />
    );
    expect(row('Fix the build')).toHaveTextContent('Importing…');
    expect(row('Fix the build')).toHaveAttribute('aria-busy', 'true');
    expect(row('Fix the build')).toBeDisabled();
    expect(row('Plan the trip')).toHaveTextContent(
      'Kiro could not open this session. Click to try again.'
    );
    expect(row('Plan the trip')).toBeEnabled();
  });

  it('changes the window from the menu', async () => {
    const state = kiro();
    render(<KiroSessionList query="" kiro={state} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Show Kiro sessions from: Last 7 days' })
    );
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Last 7 days', 'Last 30 days', 'All']);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'All' }));
    expect(state.setDays).toHaveBeenCalledWith(null);
  });

  it('says what it does while it loads, when it is empty, and when it fails', async () => {
    const { rerender } = render(<KiroSessionList query="" kiro={kiro({ sessions: undefined })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your Kiro sessions…');

    rerender(<KiroSessionList query="" kiro={kiro({ sessions: [], days: 30 })} />);
    expect(screen.getByText('No Kiro sessions in the last 30 days.')).toBeInTheDocument();

    const failed = kiro({ sessions: undefined, listError: true });
    rerender(<KiroSessionList query="" kiro={failed} />);
    expect(screen.getByText('Could not load your Kiro sessions.')).toBeInTheDocument();
    expect(screen.queryByText('Loading your Kiro sessions…')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(failed.refresh).toHaveBeenCalled();
  });

  it('says what an import left out', () => {
    render(
      <KiroSessionList
        query=""
        kiro={kiro({ notice: 'Imported. 2 images and 12 older turns were left out.' })}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Imported. 2 images and 12 older turns were left out.'
    );
  });
});
