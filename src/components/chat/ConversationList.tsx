/**
 * Component for displaying and managing conversation history
 */
import { Box, Button, Icon, SpaceBetween, Spinner } from '@cloudscape-design/components';

import type { Conversation } from '../../db';
import { useConversationMutations, useConversations } from '../../hooks';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

// Format relative time
const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Get provider icon
const getProviderIcon = (providers: string[]): string | null => {
  if (providers.includes('bedrock-mantle')) return '/bedrock-color.svg';
  if (providers.includes('bedrock')) return '/bedrock_bw.svg';
  if (providers.includes('lmstudio')) return '/lmstudio_icon.svg';
  if (providers.includes('ollama')) return '/ollama_icon.svg';
  return null;
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onArchive: () => void;
}

const ConversationItem = ({
  conversation,
  isActive,
  onSelect,
  onArchive,
}: ConversationItemProps) => {
  const providerIcon = getProviderIcon(conversation.providers);

  return (
    <div
      className={`conversation-item ${isActive ? 'conversation-item--active' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <SpaceBetween size="xxs">
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          {providerIcon && (
            <img
              src={providerIcon}
              alt=""
              style={{ width: '14px', height: '14px', opacity: 0.7 }}
            />
          )}
          <Box
            variant="small"
            fontWeight={isActive ? 'bold' : 'normal'}
            color={isActive ? 'text-body-secondary' : 'text-body-secondary'}
          >
            <span className="conversation-title">{conversation.title}</span>
          </Box>
        </SpaceBetween>
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <Box variant="small" color="text-status-inactive" fontSize="body-s">
            {formatRelativeTime(new Date(conversation.updatedAt))}
          </Box>
          <Box variant="small" color="text-status-inactive" fontSize="body-s">
            · {conversation.messageCount} msgs
          </Box>
          <Button
            variant="inline-icon"
            iconName="remove"
            ariaLabel="Archive conversation"
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          />
        </SpaceBetween>
      </SpaceBetween>
    </div>
  );
};

export const ConversationList = ({
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ConversationListProps) => {
  const { conversations, isLoading } = useConversations({ limit: 20 });
  const { archiveConversation } = useConversationMutations();

  const handleArchive = async (id: string) => {
    await archiveConversation(id);
    if (id === activeConversationId) {
      onNewChat();
    }
  };

  if (isLoading) {
    return (
      <Box textAlign="center" padding="m">
        <Spinner size="normal" />
      </Box>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <Box padding="s" color="text-status-inactive" textAlign="center">
        <SpaceBetween size="xs" alignItems="center">
          <Icon name="file" size="medium" />
          <Box variant="small">No conversations yet</Box>
        </SpaceBetween>
      </Box>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeConversationId}
          onSelect={() => onSelectConversation(conv.id)}
          onArchive={() => handleArchive(conv.id)}
        />
      ))}
    </div>
  );
};

export default ConversationList;
