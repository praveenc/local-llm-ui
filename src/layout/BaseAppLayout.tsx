'use client';
import React, { useState } from 'react';
import {
  AppLayoutToolbar,
  HelpPanel,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import messages from '@cloudscape-design/components/i18n/messages/all.en';
import SideBar from "./SideBar";
import { ChatContainer } from "../components/chat";

const LOCALE = 'en';

export default function BaseAppLayout() {
  const [selectedModel, setSelectedModel] = useState<SelectProps.Option | null>(null);
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [temperature, setTemperature] = useState<number>(0.5);
  const [topP, setTopP] = useState<number>(0.9);
  const [navigationOpen, setNavigationOpen] = useState<boolean>(true);
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<{ lmstudio: boolean; ollama: boolean }>({
    lmstudio: false,
    ollama: false
  });
  const clearHistoryRef = React.useRef<(() => void) | null>(null);

  const handleNewChat = () => {
    if (clearHistoryRef.current) {
      clearHistoryRef.current();
    }
  };

  // Check connections on mount
  React.useEffect(() => {
    const checkConnections = async () => {
      try {
        const { apiService } = await import('../services');
        const status = await apiService.checkConnections();
        setConnectionStatus(status);
      } catch (error) {
        console.error('Failed to check connections:', error);
      }
    };

    checkConnections();
    // Check every 30 seconds
    const interval = setInterval(checkConnections, 30000);
    return () => clearInterval(interval);
  }, []);

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

              <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f0f8ff', borderRadius: '4px', fontSize: '0.85em' }}>
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

              <div style={{ marginTop: '1rem', fontSize: '0.9em', color: '#666' }}>
                <p><strong>LMStudio:</strong> Download from lmstudio.ai</p>
                <p><strong>Ollama:</strong> Download from ollama.ai</p>
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
              onClearHistoryRef={clearHistoryRef}
            />
          </div>
        }
      />
    </I18nProvider>
  );
}