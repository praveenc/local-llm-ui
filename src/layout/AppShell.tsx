import { toast } from 'sonner';

import React, { useEffect, useState } from 'react';

import { ChatContainer } from '../components/chat';
import { Sidebar } from '../components/sidebar';
import { useAllModels } from '../hooks/useAllModels';
import type { UnifiedModel } from '../hooks/useAllModels';
import { conversationService } from '../services';
import { loadPreferences, savePreferences } from '../utils/preferences';
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

  // Model to select once the model list has loaded: the last used one, or the opened conversation's
  const [modelToRestore, setModelToRestore] = useState<{
    id: string;
    provider: UnifiedModel['provider'];
    conversationId: string | null;
  } | null>(null);
  if (modelToRestore && !isLoadingModels) {
    setModelToRestore(null);
    const match = providers
      .flatMap((p) => p.models)
      .find((m) => m.id === modelToRestore.id && m.provider === modelToRestore.provider);
    // Drop a stale result when the user has since opened another conversation
    if (match && modelToRestore.conversationId === activeConversationId) setSelectedModel(match);
  }

  useEffect(() => {
    void conversationService.getLatestMessage().then((message) => {
      if (message) {
        setModelToRestore(
          (current) =>
            current ?? { id: message.modelId, provider: message.provider, conversationId: null }
        );
      }
    });
  }, []);

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
    void conversationService.getLatestMessage(id).then((message) => {
      if (message) {
        setModelToRestore({ id: message.modelId, provider: message.provider, conversationId: id });
      }
    });
  };

  const handleToggleTheme = () => {
    const next: UserPreferences = {
      ...loadPreferences(),
      visualMode: userPreferences.visualMode === 'dark' ? 'light' : 'dark',
    };
    savePreferences(next);
    setUserPreferences(next);
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
      theme={userPreferences.visualMode}
      onToggleTheme={handleToggleTheme}
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
        <ChatContainer
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
