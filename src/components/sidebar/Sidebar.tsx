import { FileText, MessageSquare, Plus, Settings } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import type { UserPreferences } from '../../utils/preferences';
import { ViewPromptsModal } from '../prompts';
import { ConversationList } from './ConversationList';
import { PreferencesDialog } from './PreferencesDialog';

interface SidebarProps {
  onNewChat?: () => void;
  onPreferencesChange?: (preferences: UserPreferences) => void;
  onPreferencesSaved?: () => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
}

export function Sidebar({
  onNewChat,
  onPreferencesChange,
  onPreferencesSaved,
  activeConversationId,
  onSelectConversation,
}: SidebarProps) {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);

  const handlePreferencesSave = (newPrefs: UserPreferences) => {
    onPreferencesChange?.(newPrefs);
    onPreferencesSaved?.();
  };

  return (
    <div className="flex h-full flex-col">
      {/* New Conversation Button */}
      <div className="p-3">
        <Button onClick={onNewChat} className="w-full justify-start gap-2" variant="default">
          <Plus className="h-4 w-4" />
          New Conversation
        </Button>
      </div>

      <Separator />

      {/* Conversations */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <MessageSquare className="h-3 w-3" />
            Conversations
          </div>
        </div>
        <ScrollArea className="flex-1">
          {onNewChat && onSelectConversation && (
            <ConversationList
              activeConversationId={activeConversationId ?? null}
              onSelectConversation={onSelectConversation}
              onNewChat={onNewChat}
            />
          )}
        </ScrollArea>
      </div>

      <Separator />

      {/* Footer Actions */}
      <div className="p-2 space-y-1 bg-muted/50 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9"
          onClick={() => setPromptsOpen(true)}
        >
          <FileText className="h-4 w-4" />
          Saved Prompts
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9"
          onClick={() => setPreferencesOpen(true)}
        >
          <Settings className="h-4 w-4" />
          Preferences
        </Button>
      </div>

      {/* Modals */}
      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        onSave={handlePreferencesSave}
      />

      <ViewPromptsModal visible={promptsOpen} onDismiss={() => setPromptsOpen(false)} />
    </div>
  );
}
