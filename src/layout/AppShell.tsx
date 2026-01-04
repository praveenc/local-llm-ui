import { toast } from 'sonner';

import React, { useEffect, useState } from 'react';

import { ChatContainer } from '../components/chat';
import { Sidebar } from '../components/sidebar';
import { loadPreferences } from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';
import { AppLayout } from './AppLayout';

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
        />
      }
    >
      <div className="flex h-full flex-col">
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
      </div>
    </AppLayout>
  );
}
