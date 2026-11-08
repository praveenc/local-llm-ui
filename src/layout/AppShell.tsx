import { toast } from 'sonner';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ChatContainer } from '../components/chat';
import { Sidebar } from '../components/sidebar';
import { useAllModels } from '../hooks/useAllModels';
import type { UnifiedModel } from '../hooks/useAllModels';
import { conversationService } from '../services';
import { findModel, pickDefaultModel } from '../utils/modelSelection';
import type { ModelRef } from '../utils/modelSelection';
import { loadPreferences, savePreferences } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';
import { AppLayout } from './AppLayout';

/** Model to select once the model list has loaded */
type PendingModel =
  | { kind: 'conversation'; conversationId: string; model: ModelRef }
  | { kind: 'default'; provider: Provider; preferred?: ModelRef; any?: ModelRef };

const toModelRef = (message?: { modelId: string; provider: Provider }): ModelRef | undefined =>
  message ? { id: message.modelId, provider: message.provider } : undefined;

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

  // Model to select once the model list has loaded: the default for a new chat, or the opened
  // conversation's model
  const [pendingModel, setPendingModel] = useState<PendingModel | null>(null);
  if (pendingModel && !isLoadingModels) {
    setPendingModel(null);
    if (pendingModel.kind === 'conversation') {
      // Drop a stale result when the user has since opened another conversation
      const match = findModel(providers, pendingModel.model);
      if (match && pendingModel.conversationId === activeConversationId) setSelectedModel(match);
    } else if (activeConversationId === null) {
      const match = pickDefaultModel(providers, pendingModel.provider, pendingModel);
      if (match) setSelectedModel(match);
    }
  }

  // Only the newest request may set the pending model, so a slow lookup cannot override a newer one
  const modelRequestRef = useRef(0);
  const requestModel = useCallback((load: () => Promise<PendingModel | null>) => {
    const request = ++modelRequestRef.current;
    void load().then((next) => {
      if (request === modelRequestRef.current) setPendingModel(next);
    });
  }, []);

  const requestDefaultModel = useCallback(
    (provider: Provider) => {
      requestModel(async () => {
        const [preferred, any] = await Promise.all([
          conversationService.getLatestMessageForProvider(provider),
          conversationService.getLatestMessage(),
        ]);
        return {
          kind: 'default',
          provider,
          preferred: toModelRef(preferred),
          any: toModelRef(any),
        };
      });
    },
    [requestModel]
  );

  useEffect(() => {
    requestDefaultModel(loadPreferences().preferredProvider);
  }, [requestDefaultModel]);

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
    requestDefaultModel(userPreferences.preferredProvider);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    requestModel(async () => {
      const message = await conversationService.getLatestMessage(id);
      const model = toModelRef(message);
      return model ? { kind: 'conversation', conversationId: id, model } : null;
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
    const providerChanged = preferences.preferredProvider !== userPreferences.preferredProvider;
    setUserPreferences(preferences);
    // Apply a new default provider now, unless a conversation is open (it keeps its model)
    if (providerChanged && activeConversationId === null) {
      requestDefaultModel(preferences.preferredProvider);
    }
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
