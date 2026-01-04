import { ChevronRight, MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Today: true,
    Yesterday: true,
    'This Week': true,
  });

  const grouped = groupConversationsByDate(conversations ?? []);

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

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
    if (activeConversationId === id) {
      onNewChat();
    }
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
                            onClick={() => handleDelete(conv.id)}
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
    </div>
  );
}
