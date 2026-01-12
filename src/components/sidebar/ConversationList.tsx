import {
  AlertTriangle,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';

import { useState } from 'react';

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

interface ConversationListProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

interface GroupedConversations {
  label: string;
  conversations: Array<{
    id: string;
    title: string;
    messageCount: number;
    updatedAt: Date;
  }>;
}

function groupConversationsByDate(
  conversations: Array<{
    id: string;
    title: string;
    messageCount: number;
    updatedAt: Date;
  }>
): GroupedConversations[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const groups: Record<string, GroupedConversations> = {
    today: { label: 'Today', conversations: [] },
    yesterday: { label: 'Yesterday', conversations: [] },
    thisWeek: { label: 'This Week', conversations: [] },
    thisMonth: { label: 'This Month', conversations: [] },
    older: { label: 'Older', conversations: [] },
  };

  conversations.forEach((conv) => {
    const date = new Date(conv.updatedAt);
    if (date >= today) {
      groups.today.conversations.push(conv);
    } else if (date >= yesterday) {
      groups.yesterday.conversations.push(conv);
    } else if (date >= thisWeek) {
      groups.thisWeek.conversations.push(conv);
    } else if (date >= thisMonth) {
      groups.thisMonth.conversations.push(conv);
    } else {
      groups.older.conversations.push(conv);
    }
  });

  return Object.values(groups).filter((g) => g.conversations.length > 0);
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

  const grouped = groupConversationsByDate(conversations ?? []);

  // Determine which groups should be open by default
  // Only "Today" is expanded, unless there are no today conversations, then expand "Yesterday"
  const getDefaultOpenGroups = (): Record<string, boolean> => {
    const hasTodayConversations = grouped.some(
      (g) => g.label === 'Today' && g.conversations.length > 0
    );
    if (hasTodayConversations) {
      return { Today: true } as Record<string, boolean>;
    }
    // If no today conversations, expand yesterday
    const hasYesterdayConversations = grouped.some(
      (g) => g.label === 'Yesterday' && g.conversations.length > 0
    );
    if (hasYesterdayConversations) {
      return { Yesterday: true } as Record<string, boolean>;
    }
    // If neither, expand the first group
    if (grouped.length > 0) {
      return { [grouped[0].label]: true } as Record<string, boolean>;
    }
    return {};
  };

  // Initialize open groups based on available conversations
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    getDefaultOpenGroups()
  );

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

  const handleConfirmDelete = async () => {
    if (conversationToDelete) {
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

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  if (!conversations || conversations.length === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No conversations yet</p>
        <p className="text-xs text-muted-foreground/70">Start a new chat to begin</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {grouped.map((group) => (
        <Collapsible
          key={group.label}
          open={openGroups[group.label] ?? false}
          onOpenChange={() => toggleGroup(group.label)}
        >
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform',
                  openGroups[group.label] && 'rotate-90'
                )}
              />
              <span>{group.label}</span>
              <span className="ml-auto text-muted-foreground/60">
                ({group.conversations.length})
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-0.5 pl-2">
              {group.conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors min-w-0',
                    activeConversationId === conv.id
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent/50'
                  )}
                  onClick={() => editingId !== conv.id && onSelectConversation(conv.id)}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {editingId === conv.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleSaveRename(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(conv.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="h-6 text-sm"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="truncate flex-1 max-w-[140px]" title={conv.title}>
                        {conv.title.length > 25 ? `${conv.title.slice(0, 25)}...` : conv.title}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
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
                    </>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteModalVisible} onOpenChange={setDeleteModalVisible}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{conversationToDelete?.title}"?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
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
