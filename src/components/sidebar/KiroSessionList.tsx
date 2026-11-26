/**
 * The Kiro sessions section of the sidebar (K7, D10): Kiro's own sessions that no conversation
 * holds yet, in the same date groups as Conversations, with the folder name on each row. A click
 * imports the session and opens it as a conversation.
 */
import { ChevronDown } from 'lucide-react';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { KiroSessionRowState, UseKiroSessionsResult } from '../../hooks/useKiroSessions';
import {
  type ConversationGroupKey,
  type GroupOpenState,
  KIRO_GROUP_STATE_STORAGE_KEY,
  formatFullDateTime,
  formatRowTime,
  groupConversations,
  isGroupOpen,
  loadGroupOpenState,
  saveGroupOpenState,
} from '../../utils/conversationGroups';
import {
  KIRO_SESSION_WINDOWS,
  type KiroSessionSummary,
  type KiroSessionWindow,
} from '../../utils/kiroSessions';
import { GroupHeader } from './sidebarParts';

const SESSIONS = { one: 'session', other: 'sessions' };

const WINDOW_LABELS: Record<string, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  all: 'All',
};
const windowKey = (days: KiroSessionWindow) => (days === null ? 'all' : String(days));

function emptyText(days: KiroSessionWindow): string {
  return days === null ? 'No Kiro sessions.' : `No Kiro sessions in the last ${days} days.`;
}

/** Kiro's status word for a row, when the session is not idle: "in progress", "failed" */
function statusWord(status: string): string | null {
  const word = status.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return !word || word === 'idle' ? null : word;
}

interface KiroSessionListProps {
  /** The Search chats text of the Sidebar */
  query: string;
  kiro: UseKiroSessionsResult;
}

type Row = Omit<KiroSessionSummary, 'updatedAt'> & { updatedAt: Date };

export function KiroSessionList({ query, kiro }: KiroSessionListProps) {
  const { sessions, listError, days, setDays, refresh, rows, notice, importSession } = kiro;
  const [openState, setOpenState] = useState<GroupOpenState>(() =>
    loadGroupOpenState(KIRO_GROUP_STATE_STORAGE_KEY)
  );

  const needle = query.trim().toLowerCase();
  const items = useMemo<Row[]>(
    () => (sessions ?? []).map((s) => ({ ...s, updatedAt: new Date(s.updatedAt) })),
    [sessions]
  );
  const groups = groupConversations(
    needle ? items.filter((s) => s.title.toLowerCase().includes(needle)) : items
  );

  const toggleGroup = (key: string) => {
    const next = { ...openState, [key]: !isGroupOpen(openState, key) };
    setOpenState(next);
    saveGroupOpenState(next, KIRO_GROUP_STATE_STORAGE_KEY);
  };

  return (
    <section aria-labelledby="kiro-sessions-heading" className="pt-4 compact:pt-2">
      <div className="flex items-center gap-2 px-3 pb-1">
        <h2 id="kiro-sessions-heading" className="text-[13px] font-normal text-muted-foreground">
          Kiro sessions
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Show Kiro sessions from: ${WINDOW_LABELS[windowKey(days)]}`}
              className="ml-auto h-7 gap-1 px-2 text-xs font-normal text-muted-foreground pointer-coarse:h-11"
            >
              {WINDOW_LABELS[windowKey(days)]}
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={windowKey(days)}
              onValueChange={(value) => {
                const next = KIRO_SESSION_WINDOWS.find((d) => windowKey(d) === value);
                if (next !== undefined) setDays(next);
              }}
            >
              {KIRO_SESSION_WINDOWS.map((d) => (
                <DropdownMenuRadioItem key={windowKey(d)} value={windowKey(d)}>
                  {WINDOW_LABELS[windowKey(d)]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {notice && (
        <p role="status" className="px-3 pb-1 text-xs text-muted-foreground">
          {notice}
        </p>
      )}

      <nav aria-label="Kiro sessions">
        {listError && (
          <div className="flex items-center gap-2 px-3 py-1 text-xs text-destructive">
            <span>Could not load your Kiro sessions.</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs pointer-coarse:h-11"
              onClick={refresh}
            >
              Try again
            </Button>
          </div>
        )}
        {sessions === undefined && !listError && (
          <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
            Loading your Kiro sessions…
          </p>
        )}
        {sessions !== undefined && items.length === 0 && !needle && (
          <p className="px-3 py-1 text-xs text-muted-foreground">{emptyText(days)}</p>
        )}
        {needle && items.length > 0 && groups.length === 0 && (
          <p className="px-3 py-1 text-xs text-muted-foreground">
            No Kiro sessions match “{query.trim()}”
          </p>
        )}

        {groups.map((group) => {
          const open = needle ? true : isGroupOpen(openState, group.key);
          return (
            <Collapsible
              key={group.key}
              open={open}
              onOpenChange={() => {
                // A search opens every group with a match and leaves the stored state alone
                if (!needle) toggleGroup(group.key);
              }}
              className="pt-3 compact:pt-1.5"
            >
              <GroupHeader
                label={group.label}
                count={group.items.length}
                open={open}
                noun={SESSIONS}
              />
              <CollapsibleContent>
                <div className="flex flex-col gap-0.5 compact:gap-0 px-2">
                  {group.items.map((session) => (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      groupKey={group.key}
                      state={rows[session.sessionId]}
                      onOpen={() => void importSession(session.sessionId)}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>
    </section>
  );
}

interface SessionRowProps {
  session: Row;
  groupKey: ConversationGroupKey;
  state: KiroSessionRowState | undefined;
  onOpen: () => void;
}

function SessionRow({ session, groupKey, state, onOpen }: SessionRowProps) {
  const importing = !!state && 'importing' in state;
  const error = state && 'error' in state ? state.error : null;
  const status = statusWord(session.status);
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 compact:py-1 text-sm transition-colors hover:bg-sidebar-hover has-[button:focus-visible]:inset-ring-2 has-[button:focus-visible]:inset-ring-ring pointer-coarse:min-h-11">
      {/* One button per row: Tab reaches it and Enter imports and opens the session */}
      <button
        type="button"
        data-kiro-session={session.sessionId}
        aria-busy={importing || undefined}
        disabled={importing}
        className="flex min-w-0 flex-1 cursor-pointer flex-col text-left outline-none disabled:cursor-progress"
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate" title={session.title}>
            {session.title}
          </span>
          {session.folder && (
            <span
              className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground"
              title={`Folder: ${session.folder}`}
            >
              {session.folder}
            </span>
          )}
        </span>
        {importing && <span className="text-xs text-muted-foreground">Importing…</span>}
        {!importing && status && <span className="text-xs text-muted-foreground">{status}</span>}
        {error && <span className="text-xs text-destructive">{error} Click to try again.</span>}
      </button>
      <time
        dateTime={session.updatedAt.toISOString()}
        title={formatFullDateTime(session.updatedAt)}
        className="shrink-0 self-start pt-0.5 text-xs tabular-nums whitespace-nowrap text-muted-foreground"
      >
        {formatRowTime(session.updatedAt, groupKey)}
      </time>
    </div>
  );
}
