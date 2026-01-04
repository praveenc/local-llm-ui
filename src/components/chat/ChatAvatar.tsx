import { Bot, User } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { Spinner } from '../shared';

interface ChatAvatarProps {
  type: 'user' | 'ai';
  initials?: string;
  loading?: boolean;
  className?: string;
}

export function ChatAvatar({ type, initials = 'U', loading = false, className }: ChatAvatarProps) {
  const isAI = type === 'ai';

  return (
    <Avatar className={cn('h-8 w-8', className)}>
      <AvatarFallback
        className={cn(
          'text-xs font-medium',
          isAI
            ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {loading ? (
          <Spinner size="sm" />
        ) : isAI ? (
          <Bot className="h-4 w-4" />
        ) : (
          initials?.slice(0, 2).toUpperCase() || <User className="h-4 w-4" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
