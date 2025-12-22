/**
 * Component for displaying and managing conversation history
 */
import { useState } from 'react';

import { Box, Button, Icon, Modal, SpaceBetween, Spinner } from '@cloudscape-design/components';

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

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
      className={`conversation-item ${isActive ? 'conversation-item--active' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <div className="conversation-item__content">
        <div className="conversation-item__header">
          {providerIcon && (
            <img src={providerIcon} alt="" className="conversation-item__provider-icon" />
          )}
          <span className="conversation-item__title">{conversation.title}</span>
        </div>
        <div className="conversation-item__meta">
          <span className="conversation-item__time">
            {formatRelativeTime(new Date(conversation.updatedAt))}
          </span>
          <span className="conversation-item__count">{conversation.messageCount} msgs</span>
          <button
            className="conversation-item__delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Delete conversation"
          >
            <Icon name="close" size="small" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const ConversationList = ({
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ConversationListProps) => {
  const { conversations, isLoading } = useConversations({ limit: 15 });
  const { archiveConversation } = useConversationMutations();
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);

  const handleDeleteClick = (conversation: Conversation) => {
    setConversationToDelete(conversation);
    setDeleteModalVisible(true);
  };

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
      <Box textAlign="center" padding="s">
        <Spinner size="normal" />
      </Box>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <Box padding="s" color="text-status-inactive" textAlign="center">
        <SpaceBetween size="xxs" alignItems="center">
          <Icon name="status-info" size="small" />
          <Box variant="small">No conversations yet</Box>
          <Box variant="small" color="text-body-secondary">
            Start chatting to create one
          </Box>
        </SpaceBetween>
      </Box>
    );
  }

  return (
    <>
      <div className="conversation-list">
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeConversationId}
            onSelect={() => onSelectConversation(conv.id)}
            onDelete={() => handleDeleteClick(conv)}
          />
        ))}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        onDismiss={handleCancelDelete}
        header="Delete conversation"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={handleCancelDelete}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmDelete}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>Are you sure you want to delete "{conversationToDelete?.title}"?</Box>
          <Box color="text-status-warning" variant="small">
            <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
              <Icon name="status-warning" size="small" />
              <span>Once deleted, this conversation cannot be restored.</span>
            </SpaceBetween>
          </Box>
        </SpaceBetween>
      </Modal>
    </>
  );
};

export default ConversationList;
