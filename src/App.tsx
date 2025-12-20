import { useEffect, useRef, useState } from 'react';

import {
  AppLayout,
  Badge,
  Box,
  Button,
  ColumnLayout,
  Container,
  ExpandableSection,
  FormField,
  Header,
  Input,
  Modal,
  Select,
  SideNavigation,
  Slider,
  SpaceBetween,
} from '@cloudscape-design/components';
import PromptInput from '@cloudscape-design/components/prompt-input';

import { type Provider, apiService } from './services';

// Layout containers
const FittedContainer = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative', flexGrow: 1 }}>
    <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
  </div>
);

const ScrollableContainer = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: 'relative', blockSize: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto' }} ref={ref}>
        {children}
      </div>
    </div>
  );
};

interface Message {
  id: number;
  role: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

interface Session {
  id: number;
  title: string;
  messages: Message[];
  date: Date;
}

interface ModelSettings {
  provider: { label: string; value: Provider };
  model: { label: string; value: string };
  temperature: number;
  topP: number;
  maxTokens: number;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([
    { id: 1, title: 'New Conversation', messages: [], date: new Date() },
  ]);
  const [activeSessionId, setActiveSessionId] = useState(1);
  const [inputValue, setInputValue] = useState('');
  const [showStorageModal, setShowStorageModal] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [modelSettings, setModelSettings] = useState<ModelSettings>({
    provider: { label: 'Ollama', value: 'ollama' },
    model: { label: 'Select a model', value: '' },
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
  });

  const [storageSettings, setStorageSettings] = useState({
    chatStorage: { label: 'Local Browser Storage', value: 'local-browser' },
    fileStorage: { label: 'Local Browser Storage', value: 'local-browser' },
  });

  const [availableModels, setAvailableModels] = useState<{ label: string; value: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    lmstudio: boolean;
    ollama: boolean;
    bedrock: boolean;
  }>({ lmstudio: false, ollama: false, bedrock: false });

  const providerOptions = [
    { label: 'Ollama', value: 'ollama' as Provider },
    { label: 'LM Studio', value: 'lmstudio' as Provider },
    { label: 'Amazon Bedrock', value: 'bedrock' as Provider },
  ];

  const storageOptions = [
    { label: 'Local Browser Storage', value: 'local-browser' },
    { label: 'Custom Path', value: 'custom-path' },
  ];

  const currentSession = sessions.find((s) => s.id === activeSessionId);

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const todaySessions = sessions.filter((s) => isToday(s.date));
  const olderSessions = sessions.filter((s) => !isToday(s.date));

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentSession?.messages]);

  // Check connections on mount
  useEffect(() => {
    const checkConnections = async () => {
      try {
        const status = await apiService.checkConnections();
        setConnectionStatus(status);
      } catch (error) {
        console.error('Failed to check connections:', error);
      }
    };
    checkConnections();
  }, []);

  // Load models when provider changes
  useEffect(() => {
    const loadModels = async () => {
      setIsLoadingModels(true);
      try {
        const allModels = await apiService.getAllModels();
        const providerModels = allModels
          .filter((m) => m.provider === modelSettings.provider.value)
          .map((m) => ({ label: m.modelName, value: m.modelId }));

        setAvailableModels(providerModels);

        // Auto-select first model if available
        if (providerModels.length > 0 && !modelSettings.model.value) {
          setModelSettings((prev) => ({
            ...prev,
            model: providerModels[0],
          }));
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        setAvailableModels([]);
      } finally {
        setIsLoadingModels(false);
      }
    };
    loadModels();
  }, [modelSettings.provider.value]);

  const createSession = () => {
    const newId = Math.max(...sessions.map((s) => s.id), 0) + 1;
    const newSession: Session = {
      id: newId,
      title: 'New Conversation',
      messages: [],
      date: new Date(),
    };
    setSessions([...sessions, newSession]);
    setActiveSessionId(newId);
  };

  const deleteSession = (id: number) => {
    if (sessions.length === 1) return;
    const filtered = sessions.filter((s) => s.id !== id);
    setSessions(filtered);
    if (activeSessionId === id) {
      setActiveSessionId(filtered[0].id);
    }
  };

  const clearHistory = () => {
    setSessions(sessions.map((s) => (s.id === activeSessionId ? { ...s, messages: [] } : s)));
  };

  const sendMessage = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setSessions(
      sessions.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              messages: [...s.messages, userMessage],
              title:
                s.messages.length === 0
                  ? inputValue.slice(0, 30) + (inputValue.length > 30 ? '...' : '')
                  : s.title,
            }
          : s
      )
    );

    setInputValue('');

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: Message = {
        id: Date.now(),
        role: 'ai',
        content:
          'This is a simulated response. Connect to LMStudio or Ollama to get real responses!',
        timestamp: new Date(),
      };
      setSessions(
        sessions.map((s) =>
          s.id === activeSessionId ? { ...s, messages: [...s.messages, aiMessage] } : s
        )
      );
    }, 1000);
  };

  // Build navigation items
  const buildNavigationItems = () => {
    const items = [];

    if (todaySessions.length > 0) {
      items.push({
        type: 'section-group' as const,
        title: 'Today',
        items: todaySessions.map((session) => ({
          type: 'link' as const,
          text: session.title,
          href: `#session-${session.id}`,
          info:
            sessions.length > 1 ? (
              <Button
                variant="icon"
                iconName="close"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteSession(session.id);
                }}
              />
            ) : undefined,
        })),
      });
    }

    if (olderSessions.length > 0) {
      items.push({
        type: 'section-group' as const,
        title: 'Previous',
        items: olderSessions.map((session) => ({
          type: 'link' as const,
          text: session.title,
          href: `#session-${session.id}`,
          info:
            sessions.length > 1 ? (
              <Button
                variant="icon"
                iconName="close"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteSession(session.id);
                }}
              />
            ) : undefined,
        })),
      });
    }

    return items;
  };

  return (
    <>
      <AppLayout
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        navigation={
          <SpaceBetween direction="vertical" size="m">
            <Box padding={{ horizontal: 's' }}>
              <Button onClick={createSession} variant="primary" iconName="add-plus" fullWidth>
                New Chat
              </Button>
            </Box>
            <SideNavigation
              header={{
                text: 'Conversations',
                href: '#',
              }}
              items={buildNavigationItems()}
              activeHref={`#session-${activeSessionId}`}
              onFollow={(event) => {
                event.preventDefault();
                const sessionId = parseInt(event.detail.href.replace('#session-', ''));
                setActiveSessionId(sessionId);
              }}
            />
          </SpaceBetween>
        }
        navigationWidth={280}
        toolsHide
        content={
          <FittedContainer>
            <Container
              fitHeight
              header={
                <Header
                  variant="h2"
                  actions={
                    <SpaceBetween direction="horizontal" size="xs">
                      <Button onClick={clearHistory} iconName="remove">
                        New Chat
                      </Button>
                      <Button onClick={() => setShowStorageModal(true)} iconName="upload">
                        Storage
                      </Button>
                    </SpaceBetween>
                  }
                  info={
                    <SpaceBetween direction="horizontal" size="xs">
                      {connectionStatus.ollama && <Badge color="green">Ollama</Badge>}
                      {connectionStatus.lmstudio && <Badge color="green">LM Studio</Badge>}
                      {connectionStatus.bedrock && <Badge color="green">Bedrock</Badge>}
                      {!connectionStatus.ollama &&
                        !connectionStatus.lmstudio &&
                        !connectionStatus.bedrock && <Badge color="red">Disconnected</Badge>}
                    </SpaceBetween>
                  }
                >
                  Chat 💬
                </Header>
              }
              footer={
                <Box padding="m">
                  <SpaceBetween size="m">
                    {/* Model Settings - Expandable */}
                    <ExpandableSection
                      headerText="Model Settings"
                      expanded={settingsExpanded}
                      onChange={({ detail }) => setSettingsExpanded(detail.expanded)}
                      variant="container"
                    >
                      <SpaceBetween size="l">
                        <ColumnLayout columns={2} variant="text-grid">
                          <FormField label="Provider">
                            <Select
                              selectedOption={modelSettings.provider}
                              onChange={({ detail }) =>
                                setModelSettings({
                                  ...modelSettings,
                                  provider: detail.selectedOption as {
                                    label: string;
                                    value: Provider;
                                  },
                                  model: { label: 'Select a model', value: '' },
                                })
                              }
                              options={providerOptions}
                            />
                          </FormField>

                          <FormField label="Model">
                            <Select
                              selectedOption={modelSettings.model}
                              onChange={({ detail }) =>
                                setModelSettings({
                                  ...modelSettings,
                                  model: detail.selectedOption as { label: string; value: string },
                                })
                              }
                              options={availableModels}
                              placeholder="Select a model"
                              loadingText="Loading models..."
                              statusType={isLoadingModels ? 'loading' : 'finished'}
                              disabled={availableModels.length === 0}
                              empty="No models available"
                            />
                          </FormField>
                        </ColumnLayout>

                        <ColumnLayout columns={3} variant="text-grid">
                          <FormField label={`Temperature: ${modelSettings.temperature}`}>
                            <Slider
                              value={modelSettings.temperature}
                              onChange={({ detail }) =>
                                setModelSettings({
                                  ...modelSettings,
                                  temperature: detail.value,
                                })
                              }
                              min={0}
                              max={2}
                              step={0.1}
                            />
                          </FormField>

                          <FormField label={`Top P: ${modelSettings.topP}`}>
                            <Slider
                              value={modelSettings.topP}
                              onChange={({ detail }) =>
                                setModelSettings({
                                  ...modelSettings,
                                  topP: detail.value,
                                })
                              }
                              min={0}
                              max={1}
                              step={0.1}
                            />
                          </FormField>

                          <FormField label="Max Tokens">
                            <Input
                              type="number"
                              value={modelSettings.maxTokens.toString()}
                              onChange={({ detail }) =>
                                setModelSettings({
                                  ...modelSettings,
                                  maxTokens: parseInt(detail.value) || 0,
                                })
                              }
                            />
                          </FormField>
                        </ColumnLayout>
                      </SpaceBetween>
                    </ExpandableSection>

                    {/* Prompt Input */}
                    <PromptInput
                      value={inputValue}
                      onChange={({ detail }) => setInputValue(detail.value)}
                      onAction={() => sendMessage()}
                      placeholder="Type your message..."
                    />
                  </SpaceBetween>
                </Box>
              }
            >
              <ScrollableContainer>
                <Box padding="s">
                  {currentSession?.messages.length === 0 ? (
                    <Box color="text-body-secondary" textAlign="center" padding="xxl">
                      <SpaceBetween size="m">
                        <Box fontSize="display-l">💬</Box>
                        <Box variant="h2">Start a Conversation</Box>
                        <Box variant="p">Connect to LMStudio or Ollama and start chatting!</Box>
                      </SpaceBetween>
                    </Box>
                  ) : (
                    <SpaceBetween size="m">
                      {currentSession?.messages.map((msg) => (
                        <Box key={msg.id} padding={{ bottom: 's' }}>
                          <Box variant={msg.role === 'user' ? 'p' : 'p'}>
                            <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content}
                          </Box>
                        </Box>
                      ))}
                    </SpaceBetween>
                  )}
                  <div ref={messagesEndRef} />
                </Box>
              </ScrollableContainer>
            </Container>
          </FittedContainer>
        }
      />

      {/* Storage Settings Modal */}
      <Modal
        visible={showStorageModal}
        onDismiss={() => setShowStorageModal(false)}
        header="Storage Settings"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowStorageModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setShowStorageModal(false);
                }}
              >
                Save Settings
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <FormField label="Chat Session Storage">
            <Select
              selectedOption={storageSettings.chatStorage}
              onChange={({ detail }) =>
                setStorageSettings({
                  ...storageSettings,
                  chatStorage: detail.selectedOption as { label: string; value: string },
                })
              }
              options={storageOptions}
            />
          </FormField>

          <FormField label="File Upload Storage">
            <Select
              selectedOption={storageSettings.fileStorage}
              onChange={({ detail }) =>
                setStorageSettings({
                  ...storageSettings,
                  fileStorage: detail.selectedOption as { label: string; value: string },
                })
              }
              options={storageOptions}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}

export default App;
