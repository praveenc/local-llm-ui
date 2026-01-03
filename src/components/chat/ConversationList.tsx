/**
 * Component for displaying and managing conversation history
 * Conversations are grouped by time period (Today, Yesterday, This Week, etc.)
 */
import { AlertTriangle, Calendar, Clock, Folder, Info, X } from 'lucide-react';

import { useMemo, useState } from 'react';

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
import { cn } from '@/lib/utils';

import type { Conversation } from '../../db';
import { useConversationMutations, useConversations } from '../../hooks';
import {
  DATE_GROUP_LABELS,
  DATE_GROUP_ORDER,
  type DateGroup,
  groupByDate,
} from '../../utils/dateUtils';
import { Spinner } from '../shared';

// Map date groups to icons
const DATE_GROUP_ICONS: Record<DateGroup, React.ReactNode> = {
  today: <Calendar className="h-4 w-4" />,
  yesterday: <Clock className="h-4 w-4" />,
  thisWeek: <Clock className="h-4 w-4" />,
  thisMonth: <Clock className="h-4 w-4" />,
  older: <Folder className="h-4 w-4" />,
};

interface ConversationListProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

// Format relative time for display
const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Get provider icon based on providers used in conversation
const getProviderIcon = (providers: string[]): string | null => {
  if (providers.includes('bedrock-mantle')) return '/bedrock-color.svg';
  if (providers.includes('bedrock')) return '/bedrock_bw.svg';
  if (providers.includes('lmstudio')) return '/lmstudio_icon.svg';
  if (providers.includes('ollama')) return '/ollama_icon.svg';
  if (providers.includes('groq')) return '/groq_icon.svg';
  if (providers.includes('cerebras')) return '/cerebras_icon.svg';
  return null;
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const ConversationItem = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: ConversationItemProps) => {
  const providerIcon = getProviderIcon(conversation.providers);

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
        'hover:bg-accent',
        isActive && 'bg-accent'
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {providerIcon && <img src={providerIcon} alt="" className="w-4 h-4 flex-shrink-0" />}
          <span className="text-sm font-medium truncate">{conversation.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span>{formatRelativeTime(new Date(conversation.updatedAt))}</span>
          <span>•</span>
          <span>{conversation.messageCount} msgs</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete conversation"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
};

interface ConversationGroupProps {
  group: DateGroup;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (conversation: Conversation) => void;
  defaultExpanded?: boolean;
}

const ConversationGroup = ({
  group,
  conversations,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  defaultExpanded = true,
}: ConversationGroupProps) => {
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        {DATE_GROUP_ICONS[group]}
        <span>{DATE_GROUP_LABELS[group]}</span>
        <span className="text-xs">({conversations.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-1 pl-2">
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeConversationId}
              onSelect={() => onSelectConversation(conv.id)}
              onDelete={() => onDeleteConversation(conv)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ConversationList = ({
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ConversationListProps) => {
  const { conversations, isLoading } = useConversations({});
  const { archiveConversation } = useConversationMutations();
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);

  const handleDeleteClick = (conversation: Conversation) => {
    setConversationToDelete(conversation);
    setDeleteModalVisible(true);
  };

  // Group conversations by date
  const groupedConversations = useMemo(() => {
    if (!conversations) return {};
    return groupByDate(conversations, (conv) => new Date(conv.updatedAt));
  }, [conversations]);

  const handleConfirmDelete = async () => {
    if (conversationToDelete) {
      await archiveConversation(conversationToDelete.id);
      if (conversationToDelete.id === activeConversationId) {
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

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner size="md" />
      </div>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-4 text-center text-muted-foreground">
        <Info className="h-5 w-5" />
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-xs">Start chatting to create one</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        {DATE_GROUP_ORDER.map((group) => {
          const groupConversations = groupedConversations[group];
          if (!groupConversations || groupConversations.length === 0) return null;

          return (
            <ConversationGroup
              key={group}
              group={group}
              conversations={groupConversations}
              activeConversationId={activeConversationId}
              onSelectConversation={onSelectConversation}
              onDeleteConversation={handleDeleteClick}
              defaultExpanded={group === 'today' || group === 'yesterday'}
            />
          );
        })}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteModalVisible} onOpenChange={(open) => !open && handleCancelDelete()}>
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
    </>
  );
};

export default ConversationList;
