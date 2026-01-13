import { toast } from 'sonner';

import React, { useEffect, useState } from 'react';

import { ChatContainer } from '../components/chat';
import BedrockChatContainer from '../components/chat/BedrockChatContainer';
import { Sidebar } from '../components/sidebar';
import { useAllModels } from '../hooks/useAllModels';
import type { UnifiedModel } from '../hooks/useAllModels';
import { loadPreferences } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';
import { AppLayout } from './AppLayout';

// Feature flag for AI Elements UI (set via environment variable)
const USE_AI_ELEMENTS = import.meta.env.VITE_USE_AI_ELEMENTS === 'true';

// Simple model type for the new Sidebar
interface SimpleModel {
  value: string;
  label: string;
}

// Convert to SelectProps.Option format for ChatContainer compatibility
function toSelectOption(
  model: SimpleModel | null
): { value: string; label: string; description?: string } | null {
  if (!model) return null;
  return { value: model.value, label: model.label };
}

export default function AppShell() {
  const [selectedModel, setSelectedModel] = useState<SimpleModel | null>(null);
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

  // Track selected provider
  const [selectedProvider, setSelectedProvider] = useState<Provider>(
    () => loadPreferences().preferredProvider
  );

  // Model status for ChatContainer
  const [modelStatus, setModelStatus] = useState<{
    type: 'error' | 'warning' | 'info';
    header: string;
    content: string;
  } | null>(null);

  // Unified model selection for AI Elements UI
  const [unifiedSelectedModel, setUnifiedSelectedModel] = useState<UnifiedModel | null>(null);
  const { providers, isLoading: isLoadingModels } = useAllModels(userPreferences);

  // Handle unified model selection
  const handleUnifiedModelSelect = (model: UnifiedModel) => {
    setUnifiedSelectedModel(model);
    // Also update the provider based on selected model
    setSelectedProvider(model.provider);
  };

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

  const handleConnectionError = (error: { title: string; content: string }) => {
    toast.error(error.title, { description: error.content });
  };

  const handleModelLoadError = (error: { title: string; content: string }) => {
    toast.error(error.title, { description: error.content });
  };

  const handleModelLoadSuccess = (modelName: string) => {
    toast.success(`Model "${modelName}" loaded successfully`);
  };

  const handleModelStatusChange = (
    status: { type: 'error' | 'warning' | 'info'; header: string; content: string } | null
  ) => {
    setModelStatus(status);
  };

  const handleDismissModelStatus = () => {
    setModelStatus(null);
  };

  return (
    <AppLayout
      navigationOpen={navigationOpen}
      onNavigationChange={setNavigationOpen}
      navigation={
        <Sidebar
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          onNewChat={handleNewChat}
          onPreferencesChange={handlePreferencesChange}
          onPreferencesSaved={handlePreferencesSaved}
          selectedProvider={selectedProvider}
          onProviderChange={setSelectedProvider}
          onModelLoadError={handleModelLoadError}
          onModelLoadSuccess={handleModelLoadSuccess}
          onModelStatusChange={handleModelStatusChange}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          hideModelSelection={USE_AI_ELEMENTS}
        />
      }
    >
      <div className="flex h-full flex-col">
        {/* Use AI Elements UI for Bedrock when feature flag is enabled */}
        {USE_AI_ELEMENTS ? (
          <BedrockChatContainer
            providers={providers}
            selectedModel={unifiedSelectedModel}
            onSelectModel={handleUnifiedModelSelect}
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
        ) : (
          <ChatContainer
            selectedModel={toSelectOption(selectedModel)}
            selectedProvider={selectedProvider}
            maxTokens={maxTokens}
            setMaxTokens={setMaxTokens}
            temperature={temperature}
            setTemperature={setTemperature}
            topP={topP}
            setTopP={setTopP}
            samplingParameter={samplingParameter}
            setSamplingParameter={setSamplingParameter}
            onClearHistoryRef={clearHistoryRef}
            avatarInitials={userPreferences.avatarInitials}
            onConnectionError={handleConnectionError}
            modelStatus={modelStatus}
            onDismissModelStatus={handleDismissModelStatus}
            conversationId={activeConversationId}
            onConversationChange={handleConversationChange}
          />
        )}
      </div>
    </AppLayout>
  );
}
