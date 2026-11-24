import {
  AlertTriangle,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useConversationMutations, useConversations } from '../../hooks';
import {
  type GroupOpenState,
  formatFullDateTime,
  formatRowTime,
  groupConversations,
  isGroupOpen,
  loadGroupOpenState,
  saveGroupOpenState,
} from '../../utils/conversationGroups';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

export function ConversationList({
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ConversationListProps) {
  const { conversations } = useConversations();
  const { deleteConversation, updateConversationTitle } = useConversationMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const now = new Date();
  const allGroups = groupConversations(conversations ?? [], now);
  // A search shows only the matching conversations, in their date groups, all open
  const grouped = needle
    ? allGroups
        .map((g) => ({
          ...g,
          items: g.items.filter((c) => c.title.toLowerCase().includes(needle)),
        }))
        .filter((g) => g.items.length > 0)
    : allGroups;

  // Open groups are kept in the browser; groups without a stored value use the default
  const [openState, setOpenState] = useState<GroupOpenState>(loadGroupOpenState);

  const handleRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleSaveRename = async (id: string) => {
    if (editTitle.trim()) {
      await updateConversationTitle(id, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };

  const handleDeleteClick = (conv: { id: string; title: string }) => {
    setConversationToDelete(conv);
    setDeleteModalVisible(true);
  };

  // Row to focus after a delete: the next one, else the previous one
  const focusAfterDelete = useRef<string | null>(null);

  const handleConfirmDelete = async () => {
    if (conversationToDelete) {
      const ids = grouped.flatMap((g) => g.items.map((c) => c.id));
      const index = ids.indexOf(conversationToDelete.id);
      focusAfterDelete.current = ids[index + 1] ?? ids[index - 1] ?? null;
      await deleteConversation(conversationToDelete.id);
      if (activeConversationId === conversationToDelete.id) {
        onNewChat();
      }
    }
    setDeleteModalVisible(false);
    setConversationToDelete(null);
  };

  const handleCancelDelete = () => {
    setDeleteModalVisible(false);
    setConversationToDelete(null);
  };

  const toggleGroup = (key: string) => {
    const next = { ...openState, [key]: !isGroupOpen(openState, key) };
    setOpenState(next);
    saveGroupOpenState(next);
  };

  if (!conversations || conversations.length === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No conversations yet</p>
        <p className="text-xs text-muted-foreground">Start a new chat to begin</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="relative px-2 pb-1">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-[calc(50%+2px)] text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
          placeholder="Search chats"
          aria-label="Search chats"
          className="h-8 pl-7 text-sm"
        />
      </div>
      {needle && grouped.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
          No chats match “{query.trim()}”
        </p>
      )}
      {grouped.map((group) => {
        const open = needle ? true : isGroupOpen(openState, group.key);
        const count = group.items.length;
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
            {/* The header stays at the top of the list while its rows scroll by */}
            <h3 className="sticky top-0 z-10 bg-sidebar px-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  // A closed group says how many chats it hides: "Previous 30 days, 8 chats"
                  aria-label={
                    open ? undefined : `${group.label}, ${count} ${count === 1 ? 'chat' : 'chats'}`
                  }
                  className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:inset-ring-2 focus-visible:inset-ring-ring motion-reduce:transition-none pointer-coarse:min-h-11"
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0 transition-transform motion-reduce:transition-none',
                      open && 'rotate-90'
                    )}
                  />
                  <span className="truncate">{group.label}</span>
                  {!open && (
                    <span
                      aria-hidden
                      className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground"
                    >
                      {count}
                    </span>
                  )}
                </button>
              </CollapsibleTrigger>
            </h3>
            <CollapsibleContent>
              <div className="flex flex-col gap-0.5 compact:gap-0 px-2">
                {group.items.map((conv) => {
                  const updatedAt = new Date(conv.updatedAt);
                  const isActive = activeConversationId === conv.id;
                  return (
                    <div
                      key={conv.id}
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5 compact:py-1 text-sm transition-colors min-w-0 has-[[data-row-title]:focus-visible]:inset-ring-2 has-[[data-row-title]:focus-visible]:inset-ring-ring',
                        isActive
                          ? 'bg-sidebar-active font-medium text-tint-text'
                          : 'hover:bg-sidebar-hover'
                      )}
                    >
                      {editingId === conv.id ? (
                        <>
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={() => handleSaveRename(conv.id)}
                            onKeyDown={(e) => {
                              // keyCode 229 covers Safari, which clears isComposing before this keydown
                              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                              if (e.key === 'Enter') handleSaveRename(conv.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="h-6 text-sm"
                            autoFocus
                            aria-label="Conversation title"
                          />
                        </>
                      ) : (
                        <>
                          {/* The whole title area is one button, so Tab reaches it and Enter opens it */}
                          <button
                            type="button"
                            data-row-title={conv.id}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none cursor-pointer"
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => onSelectConversation(conv.id)}
                          >
                            <span className="truncate" title={conv.title}>
                              {conv.title}
                            </span>
                          </button>
                          {/* The time and the options button share one cell, so the title keeps
                              its width when the button replaces the time. On touch screens the
                              button always shows, next to the time. */}
                          <div className="grid shrink-0 items-center gap-1 font-normal">
                            <time
                              dateTime={updatedAt.toISOString()}
                              title={formatFullDateTime(updatedAt)}
                              className={cn(
                                'col-start-1 row-start-1 justify-self-end text-xs tabular-nums whitespace-nowrap group-focus-within:invisible group-hover:invisible group-has-[[data-state=open]]:invisible pointer-coarse:visible!',
                                // Muted grey is below 4.5:1 on the active row in some themes
                                isActive ? 'text-tint-text' : 'text-muted-foreground'
                              )}
                            >
                              {formatRowTime(updatedAt, group.key)}
                            </time>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Options for ${conv.title}`}
                                  className="col-start-1 row-start-1 h-6 w-6 justify-self-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:col-start-2 pointer-coarse:opacity-100 transition-opacity motion-reduce:transition-none"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleRename(conv.id, conv.title)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => handleDeleteClick(conv)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteModalVisible} onOpenChange={setDeleteModalVisible}>
        <DialogContent
          className="sm:max-w-md"
          onCloseAutoFocus={(event) => {
            // The deleted row's menu button is gone; move to a neighbouring row
            const id = focusAfterDelete.current;
            focusAfterDelete.current = null;
            const row = id
              ? document.querySelector<HTMLElement>(`[data-row-title="${CSS.escape(id)}"]`)
              : null;
            if (row) {
              event.preventDefault();
              row.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{conversationToDelete?.title}"?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-status-warn">
            <AlertTriangle className="h-4 w-4" />
            <span>Once deleted, this conversation cannot be restored.</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCancelDelete}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
