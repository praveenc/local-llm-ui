import { toast } from 'sonner';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ChatContainer } from '../components/chat';
import { Sidebar } from '../components/sidebar';
import { useAllModels } from '../hooks/useAllModels';
import type { UnifiedModel } from '../hooks/useAllModels';
import { conversationService } from '../services';
import { DEFAULT_COLOR_THEME, applyColorTheme, isColorTheme } from '../utils/colorThemes';
import { findModel, pickDefaultModel } from '../utils/modelSelection';
import type { ModelRef } from '../utils/modelSelection';
import {
  clearLastSelectedModel,
  loadLastSelectedModel,
  loadPreferences,
  saveLastSelectedModel,
  savePreferences,
} from '../utils/preferences';
import type { Provider, UserPreferences } from '../utils/preferences';
import { getDefaultThinkingEffort } from '../utils/thinkingEffort';
import type { ThinkingEffort } from '../utils/thinkingEffort';
import { loadMaxToolSteps, saveMaxToolSteps } from '../utils/toolSteps';
import { AppLayout } from './AppLayout';

/** Model to select once the model list has loaded */
type PendingModel =
  | { kind: 'conversation'; conversationId: string; model: ModelRef }
  | {
      kind: 'default';
      provider: Provider;
      last?: ModelRef;
      preferred?: ModelRef;
      any?: ModelRef;
    };

const toModelRef = (message?: { modelId: string; provider: Provider }): ModelRef | undefined =>
  message ? { id: message.modelId, provider: message.provider } : undefined;

export default function AppShell() {
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  // Max tool steps is kept across sessions
  const [maxToolSteps, setMaxToolStepsState] = useState<number>(() => loadMaxToolSteps());
  const setMaxToolSteps = (steps: number) => {
    setMaxToolStepsState(steps);
    saveMaxToolSteps(steps);
  };
  const [navigationOpen, setNavigationOpen] = useState<boolean>(true);
  const clearHistoryRef = React.useRef<(() => void) | null>(null);
  // Set by ChatContainer: puts text into the chat input (saved prompts use it)
  const insertPromptRef = React.useRef<((text: string) => void) | null>(null);

  // Conversation state
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Load user preferences
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => loadPreferences());

  // Unified model selection
  const [selectedModel, setSelectedModel] = useState<UnifiedModel | null>(null);
  const { providers, isLoading: isLoadingModels } = useAllModels(userPreferences);

  // Thinking effort: starts at the provider's default from Preferences each time the provider
  // changes, then keeps the user's pick from the chat input
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('default');
  const applyModel = (model: UnifiedModel) => {
    if (model.provider !== selectedModel?.provider) {
      setThinkingEffort(
        getDefaultThinkingEffort(userPreferences.thinkingEffortByProvider, model.provider)
      );
    }
    setSelectedModel(model);
  };

  // A model picked in the chat input is also the default for new chats
  const handleSelectModel = (model: UnifiedModel) => {
    applyModel(model);
    saveLastSelectedModel(model);
  };

  // Model to select once the model list has loaded: the default for a new chat, or the opened
  // conversation's model
  const [pendingModel, setPendingModel] = useState<PendingModel | null>(null);
  if (pendingModel && !isLoadingModels) {
    setPendingModel(null);
    if (pendingModel.kind === 'conversation') {
      // Drop a stale result when the user has since opened another conversation
      const match = findModel(providers, pendingModel.model);
      if (match && pendingModel.conversationId === activeConversationId) applyModel(match);
    } else if (activeConversationId === null) {
      const match = pickDefaultModel(providers, pendingModel.provider, pendingModel);
      if (match) applyModel(match);
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
          last: loadLastSelectedModel(),
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

  // Apply the color theme and visual mode on mount and when preferences change
  useEffect(() => {
    applyColorTheme(
      window.document.documentElement,
      userPreferences.colorTheme,
      userPreferences.visualMode
    );
  }, [userPreferences.colorTheme, userPreferences.visualMode]);

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
    handleAppearanceChange({
      visualMode: userPreferences.visualMode === 'dark' ? 'light' : 'dark',
    });
  };

  // Header theme menu and toggle: save on top of the latest stored preferences
  const handleAppearanceChange = (
    change: Partial<Pick<UserPreferences, 'colorTheme' | 'visualMode'>>
  ) => {
    const next: UserPreferences = { ...loadPreferences(), ...change };
    savePreferences(next);
    setUserPreferences(next);
  };

  const handleConversationChange = (id: string | null) => {
    setActiveConversationId(id);
  };

  const handlePreferencesChange = (preferences: UserPreferences) => {
    const providerChanged = preferences.preferredProvider !== userPreferences.preferredProvider;
    setUserPreferences(preferences);
    // Apply a changed default effort to the selected model's provider now
    if (selectedModel) {
      const oldDefault = getDefaultThinkingEffort(
        userPreferences.thinkingEffortByProvider,
        selectedModel.provider
      );
      const newDefault = getDefaultThinkingEffort(
        preferences.thinkingEffortByProvider,
        selectedModel.provider
      );
      if (newDefault !== oldDefault) setThinkingEffort(newDefault);
    }
    if (providerChanged) {
      // A new default provider replaces the model last picked in the chat input
      clearLastSelectedModel();
      // Apply it now, unless a conversation is open (it keeps its model)
      if (activeConversationId === null) requestDefaultModel(preferences.preferredProvider);
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
      colorTheme={
        isColorTheme(userPreferences.colorTheme) ? userPreferences.colorTheme : DEFAULT_COLOR_THEME
      }
      onColorThemeChange={(colorTheme) => handleAppearanceChange({ colorTheme })}
      onVisualModeChange={(visualMode) => handleAppearanceChange({ visualMode })}
      navigation={
        <Sidebar
          onNewChat={handleNewChat}
          onInsertPrompt={(text) => insertPromptRef.current?.(text)}
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
          onSelectModel={handleSelectModel}
          isLoadingModels={isLoadingModels}
          maxTokens={maxTokens}
          setMaxTokens={setMaxTokens}
          maxToolSteps={maxToolSteps}
          setMaxToolSteps={setMaxToolSteps}
          thinkingEffort={thinkingEffort}
          setThinkingEffort={setThinkingEffort}
          conversationId={activeConversationId}
          onConversationChange={handleConversationChange}
          onClearHistoryRef={clearHistoryRef}
          onInsertPromptRef={insertPromptRef}
        />
      </div>
    </AppLayout>
  );
}
