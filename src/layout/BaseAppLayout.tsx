'use client';

import React, { useState } from 'react';

import {
  Alert,
  AppLayoutToolbar,
  Box,
  Flashbar,
  HelpPanel,
  Link,
  SpaceBetween,
  StatusIndicator,
} from '@cloudscape-design/components';
import type { FlashbarProps } from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import messages from '@cloudscape-design/components/i18n/messages/all.en';

import { ChatContainer } from '../components/chat';
import { loadPreferences } from '../utils/preferences';
import type { UserPreferences } from '../utils/preferences';
import SideBar from './SideBar';

const LOCALE = 'en';

type Provider = 'lmstudio' | 'ollama' | 'bedrock';

export default function BaseAppLayout() {
  const [selectedModel, setSelectedModel] = useState<SelectProps.Option | null>(null);
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [temperature, setTemperature] = useState<number>(0.5);
  const [topP, setTopP] = useState<number>(0.9);
  const [samplingParameter, setSamplingParameter] = useState<'temperature' | 'topP'>('temperature');
  const [navigationOpen, setNavigationOpen] = useState<boolean>(true);
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    lmstudio: boolean;
    ollama: boolean;
    bedrock: boolean;
  }>({
    lmstudio: false,
    ollama: false,
    bedrock: false,
  });
  const clearHistoryRef = React.useRef<(() => void) | null>(null);

  // Load user preferences
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => loadPreferences());

  // Track selected provider (lifted from SideBar for connection checking)
  const [selectedProvider, setSelectedProvider] = useState<Provider>(
    () => loadPreferences().preferredProvider
  );

  // Flashbar notifications
  const [flashbarItems, setFlashbarItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const handleNewChat = () => {
    if (clearHistoryRef.current) {
      clearHistoryRef.current();
    }
  };

  const handlePreferencesChange = (preferences: UserPreferences) => {
    setUserPreferences(preferences);
  };

  const handlePreferencesSaved = () => {
    const id = `preferences-saved-${Date.now()}`;
    setFlashbarItems((prev) => [
      ...prev,
      {
        type: 'success',
        dismissible: true,
        dismissLabel: 'Dismiss message',
        content: 'Preferences saved successfully',
        id,
        onDismiss: () => setFlashbarItems((items) => items.filter((item) => item.id !== id)),
      },
    ]);
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setFlashbarItems((items) => items.filter((item) => item.id !== id));
    }, 3000);
  };

  // Check connection only for the selected provider
  React.useEffect(() => {
    const checkConnection = async () => {
      try {
        const { apiService } = await import('../services');
        const isConnected = await apiService.checkConnection(selectedProvider);
        setConnectionStatus((prev) => ({
          ...prev,
          [selectedProvider]: isConnected,
        }));
      } catch (error) {
        console.error(`Failed to check ${selectedProvider} connection:`, error);
      }
    };

    checkConnection();
    // Check every 30 seconds
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [selectedProvider]);

  return (
    <I18nProvider locale={LOCALE} messages={[messages]}>
      <AppLayoutToolbar
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        notifications={<Flashbar items={flashbarItems} />}
        navigation={
          <SideBar
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            onNewChat={handleNewChat}
            onPreferencesChange={handlePreferencesChange}
            onPreferencesSaved={handlePreferencesSaved}
            selectedProvider={selectedProvider}
            onProviderChange={setSelectedProvider}
          />
        }
        toolsOpen={toolsOpen}
        onToolsChange={({ detail }) => setToolsOpen(detail.open)}
        tools={
          <HelpPanel header={<h2>Connection Status</h2>}>
            <SpaceBetween size="m">
              <SpaceBetween size="xs">
                <Box>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Box fontWeight="bold">LMStudio:</Box>
                    {connectionStatus.lmstudio ? (
                      <StatusIndicator type="success">Connected (port 1234)</StatusIndicator>
                    ) : (
                      <StatusIndicator type="error">Not connected</StatusIndicator>
                    )}
                  </SpaceBetween>
                </Box>
                <Box>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Box fontWeight="bold">Ollama:</Box>
                    {connectionStatus.ollama ? (
                      <StatusIndicator type="success">Connected (port 11434)</StatusIndicator>
                    ) : (
                      <StatusIndicator type="error">Not connected</StatusIndicator>
                    )}
                  </SpaceBetween>
                </Box>
                <Box>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Box fontWeight="bold">Amazon Bedrock:</Box>
                    {connectionStatus.bedrock ? (
                      <StatusIndicator type="success">Connected</StatusIndicator>
                    ) : (
                      <StatusIndicator type="error">Not connected</StatusIndicator>
                    )}
                  </SpaceBetween>
                </Box>
              </SpaceBetween>

              <Alert type="info" header="LMStudio Setup">
                <SpaceBetween size="xs">
                  <Box variant="p">If LMStudio is connected but no models appear:</Box>
                  <Box variant="small">
                    1. Load a model in LMStudio (Chat or Developer tab)
                    <br />
                    2. OR enable "JIT Loading" in Developer → Server Settings
                  </Box>
                  <Box variant="small" color="text-body-secondary">
                    LMStudio only shows loaded models, not all downloaded ones.
                  </Box>
                </SpaceBetween>
              </Alert>

              <Alert type="warning" header="Amazon Bedrock Setup">
                <SpaceBetween size="xs">
                  <Box variant="p">To use Amazon Bedrock, configure AWS credentials:</Box>
                  <Box variant="small">
                    1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
                    <br />
                    2. Or use AWS CLI: <Box variant="code">aws configure</Box>
                    <br />
                    3. Ensure IAM permissions for Bedrock
                  </Box>
                </SpaceBetween>
              </Alert>

              <Box variant="small" color="text-body-secondary">
                <SpaceBetween size="xxs">
                  <Box>
                    <Box fontWeight="bold" display="inline">
                      LMStudio:
                    </Box>{' '}
                    <Link href="https://lmstudio.ai" external>
                      lmstudio.ai
                    </Link>
                  </Box>
                  <Box>
                    <Box fontWeight="bold" display="inline">
                      Ollama:
                    </Box>{' '}
                    <Link href="https://ollama.ai" external>
                      ollama.ai
                    </Link>
                  </Box>
                  <Box>
                    <Box fontWeight="bold" display="inline">
                      Bedrock:
                    </Box>{' '}
                    <Link href="https://aws.amazon.com/bedrock" external>
                      AWS cloud service
                    </Link>
                  </Box>
                </SpaceBetween>
              </Box>
            </SpaceBetween>
          </HelpPanel>
        }
        content={
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <ChatContainer
              selectedModel={selectedModel}
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
            />
          </div>
        }
      />
    </I18nProvider>
  );
}
