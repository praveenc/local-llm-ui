import { toast } from 'sonner';

import React, { useEffect, useState } from 'react';

import { BedrockChatContainer } from '../components/chat';
import { Sidebar } from '../components/sidebar';
import { useAllModels } from '../hooks/useAllModels';
import type { UnifiedModel } from '../hooks/useAllModels';
import { loadPreferences } from '../utils/preferences';
import type { UserPreferences } from '../utils/preferences';
import { AppLayout } from './AppLayout';

export default function AppShell() {
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [temperature, setTemperature] = useState<number>(0.5);
  const [topP, setTopP] = useState<number>(0.9);
  const [samplingParameter, setSamplingParameter] = useState<'temperature' | 'topP'>('temperature');
  const [navigationOpen, setNavigationOpen] = useState<boolean>(true);
  const clearHistoryRef = React.useRef<(() => void) | null>(null);

  // Conversation state
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Load user preferences
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => loadPreferences());

  // Unified model selection
  const [selectedModel, setSelectedModel] = useState<UnifiedModel | null>(null);
  const { providers, isLoading: isLoadingModels } = useAllModels(userPreferences);

  // Apply theme on mount and when preferences change
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.toggle('dark', userPreferences.visualMode === 'dark');
  }, [userPreferences.visualMode]);

  const handleNewChat = () => {
    setActiveConversationId(null);
    if (clearHistoryRef.current) {
      clearHistoryRef.current();
    }
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
  };

  const handleConversationChange = (id: string | null) => {
    setActiveConversationId(id);
  };

  const handlePreferencesChange = (preferences: UserPreferences) => {
    setUserPreferences(preferences);
  };

  const handlePreferencesSaved = () => {
    toast.success('Preferences saved successfully');
  };

  return (
    <AppLayout
      navigationOpen={navigationOpen}
      onNavigationChange={setNavigationOpen}
      navigation={
        <Sidebar
          onNewChat={handleNewChat}
          onPreferencesChange={handlePreferencesChange}
          onPreferencesSaved={handlePreferencesSaved}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
        />
      }
    >
      <div className="flex h-full flex-col">
        <BedrockChatContainer
          providers={providers}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          isLoadingModels={isLoadingModels}
          maxTokens={maxTokens}
          setMaxTokens={setMaxTokens}
          temperature={temperature}
          setTemperature={setTemperature}
          topP={topP}
          setTopP={setTopP}
          samplingParameter={samplingParameter}
          setSamplingParameter={setSamplingParameter}
          avatarInitials={userPreferences.avatarInitials}
          conversationId={activeConversationId}
          onConversationChange={handleConversationChange}
          onClearHistoryRef={clearHistoryRef}
        />
      </div>
    </AppLayout>
  );
}
