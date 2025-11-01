'use client';
import Avatar from '@cloudscape-design/chat-components/avatar';

interface ChatAvatarProps {
  type: 'user' | 'gen-ai';
  name?: string;
  initials?: string;
  loading?: boolean;
}

const ChatAvatar = ({ type, name = 'PC', initials = 'PC', loading }: ChatAvatarProps) => {
  if (type === 'gen-ai') {
    return <Avatar color="gen-ai" iconName="gen-ai" tooltipText={name} ariaLabel={name} loading={loading} />;
  }

  return <Avatar initials={initials} tooltipText={name} ariaLabel={name} />;
};

export default ChatAvatar;