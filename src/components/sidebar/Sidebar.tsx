import { FileText, Plus, Settings } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import { ViewPromptsModal } from '../prompts';
import { ConversationList } from './ConversationList';

interface SidebarProps {
  onNewChat?: () => void;
  /** Put a saved prompt's text into the chat input */
  onInsertPrompt?: (text: string) => void;
  /** AppShell owns the Preferences dialog, so it also opens from the chat */
  onOpenPreferences?: () => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
}

export function Sidebar({
  onNewChat,
  onInsertPrompt,
  onOpenPreferences,
  activeConversationId,
  onSelectConversation,
}: SidebarProps) {
  const [promptsOpen, setPromptsOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* New Conversation Button */}
      <div className="p-3 compact:p-2">
        <Button onClick={onNewChat} className="w-full justify-start gap-2" variant="outline">
          <Plus className="h-4 w-4" />
          New Conversation
        </Button>
      </div>

      <Separator />

      {/* Conversations */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2">
          <h2 className="text-[13px] text-muted-foreground font-normal">Conversations</h2>
        </div>
        <ScrollArea className="flex-1">
          <nav aria-label="Conversations">
            {onNewChat && onSelectConversation && (
              <ConversationList
                activeConversationId={activeConversationId ?? null}
                onSelectConversation={onSelectConversation}
                onNewChat={onNewChat}
              />
            )}
          </nav>
        </ScrollArea>
      </div>

      <Separator />

      {/* Footer Actions */}
      <div className="p-2 space-y-1 bg-muted/50 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9 compact:h-8"
          onClick={() => setPromptsOpen(true)}
        >
          <FileText className="h-4 w-4" />
          Saved Prompts
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9 compact:h-8"
          onClick={onOpenPreferences}
        >
          <Settings className="h-4 w-4" />
          Preferences
        </Button>
      </div>

      {/* Modals */}
      <ViewPromptsModal
        visible={promptsOpen}
        onDismiss={() => setPromptsOpen(false)}
        onInsertPrompt={onInsertPrompt}
      />
    </div>
  );
}
