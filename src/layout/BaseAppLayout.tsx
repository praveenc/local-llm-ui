'use client';

import React, { useState } from 'react';

import { AppLayoutToolbar, HelpPanel, SpaceBetween } from '@cloudscape-design/components';
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

  const handleNewChat = () => {
    if (clearHistoryRef.current) {
      clearHistoryRef.current();
    }
  };

  const handlePreferencesChange = (preferences: UserPreferences) => {
    setUserPreferences(preferences);
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
        navigation={
          <SideBar
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            onNewChat={handleNewChat}
            onPreferencesChange={handlePreferencesChange}
            selectedProvider={selectedProvider}
            onProviderChange={setSelectedProvider}
          />
        }
        toolsOpen={toolsOpen}
        onToolsChange={({ detail }) => setToolsOpen(detail.open)}
        tools={
          <HelpPanel header={<h2>Connection Status</h2>}>
            <SpaceBetween size="m">
              <div>
                <strong>LMStudio:</strong>{' '}
                {connectionStatus.lmstudio ? (
                  <span style={{ color: 'green' }}>✓ Connected (port 1234)</span>
                ) : (
                  <span style={{ color: 'red' }}>✗ Not connected</span>
                )}
              </div>
              <div>
                <strong>Ollama:</strong>{' '}
                {connectionStatus.ollama ? (
                  <span style={{ color: 'green' }}>✓ Connected (port 11434)</span>
                ) : (
                  <span style={{ color: 'red' }}>✗ Not connected</span>
                )}
              </div>
              <div>
                <strong>Amazon Bedrock:</strong>{' '}
                {connectionStatus.bedrock ? (
                  <span style={{ color: 'green' }}>✓ Connected</span>
                ) : (
                  <span style={{ color: 'red' }}>✗ Not connected</span>
                )}
              </div>

              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  backgroundColor: '#f0f8ff',
                  borderRadius: '4px',
                  fontSize: '0.85em',
                }}
              >
                <strong>💡 LMStudio Setup:</strong>
                <p style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  If LMStudio is connected but no models appear:
                </p>
                <ol style={{ marginLeft: '1.2rem', marginTop: '0.5rem' }}>
                  <li>Load a model in LMStudio (Chat or Developer tab)</li>
                  <li>OR enable "JIT Loading" in Developer → Server Settings</li>
                </ol>
                <p style={{ marginTop: '0.5rem', fontSize: '0.9em', color: '#666' }}>
                  LMStudio only shows loaded models, not all downloaded ones.
                </p>
              </div>

              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  backgroundColor: '#fff3cd',
                  borderRadius: '4px',
                  fontSize: '0.85em',
                }}
              >
                <strong>🔐 Amazon Bedrock Setup:</strong>
                <p style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  To use Amazon Bedrock, configure AWS credentials:
                </p>
                <ol style={{ marginLeft: '1.2rem', marginTop: '0.5rem' }}>
                  <li>Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY</li>
                  <li>
                    Or use AWS CLI: <code>aws configure</code>
                  </li>
                  <li>Ensure IAM permissions for Bedrock</li>
                </ol>
              </div>

              <div style={{ marginTop: '1rem', fontSize: '0.9em', color: '#666' }}>
                <p>
                  <strong>LMStudio:</strong> Download from lmstudio.ai
                </p>
                <p>
                  <strong>Ollama:</strong> Download from ollama.ai
                </p>
                <p>
                  <strong>Bedrock:</strong> AWS cloud service
                </p>
              </div>
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
