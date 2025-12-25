'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Alert, Box, Button, Icon, SpaceBetween } from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

import { FittedContainer, ScrollableContainer } from '../../components/layout';
import type { Provider } from '../../db';
import { useConversation, useConversationMutations, usePromptOptimizer } from '../../hooks';
import '../../styles/chatContainer.scss';
import FloatingChatInput from './FloatingChatInput';
import MessageList from './MessageList';
import OptimizePromptModal from './OptimizePromptModal';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

interface ErrorState {
  type: 'error';
  title: string;
  content: string;
}

type SamplingParameter = 'temperature' | 'topP';

interface ChatContainerProps {
  selectedModel: SelectProps.Option | null;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  samplingParameter: SamplingParameter;
  setSamplingParameter: (param: SamplingParameter) => void;
  onClearHistoryRef?: React.MutableRefObject<(() => void) | null>;
  avatarInitials?: string;
  onConnectionError?: (error: { title: string; content: string }) => void;
  modelStatus?: {
    type: 'error' | 'warning' | 'info';
    header: string;
    content: string;
  } | null;
  onDismissModelStatus?: () => void;
  conversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
}

// Helper to determine provider from model description
const getProviderFromModel = (model: SelectProps.Option | null): Provider => {
  if (model?.description?.toLowerCase().includes('ollama')) return 'ollama';
  if (model?.description?.toLowerCase().includes('bedrock-mantle')) return 'bedrock-mantle';
  if (model?.description?.toLowerCase().includes('bedrock')) return 'bedrock';
  if (model?.description?.toLowerCase().includes('groq')) return 'groq';
  if (model?.description?.toLowerCase().includes('cerebras')) return 'cerebras';
  return 'lmstudio';
};

const ChatContainer = ({
  selectedModel,
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature,
  topP,
  setTopP,
  samplingParameter,
  setSamplingParameter,
  onClearHistoryRef,
  avatarInitials = 'PC',
  onConnectionError,
  modelStatus,
  onDismissModelStatus,
  conversationId: externalConversationId,
  onConversationChange,
}: ChatContainerProps) => {
  const [inputValue, setInputValue] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [sessionId] = useState<string>(
    () => `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  const [bedrockMetadata, setBedrockMetadata] = useState<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  } | null>(null);
  const [lmstudioMetadata, setLmstudioMetadata] = useState<{
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Conversation persistence state
  const [internalConversationId, setInternalConversationId] = useState<string | null>(null);
  const activeConversationId = externalConversationId ?? internalConversationId;

  // Load conversation from DB
  const { messages: dbMessages } = useConversation(activeConversationId);
  const { createConversation, addMessage, getNextSequence } = useConversationMutations();

  // Sync DB messages to local state when conversation loads
  useEffect(() => {
    if (dbMessages && dbMessages.length > 0) {
      const localMessages: Message[] = dbMessages.map((m, idx) => ({
        id: idx + 1,
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      setMessages(localMessages);
    }
  }, [dbMessages]);

  // Prompt optimization state
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [previousPrompt, setPreviousPrompt] = useState<string | null>(null);
  const {
    isOptimizing,
    error: optimizeError,
    optimize,
    clearError: clearOptimizeError,
  } = usePromptOptimizer();

  // Determine if optimize button should be shown
  const showOptimizeButton = useMemo(() => {
    const isBedrockProvider =
      selectedModel?.description?.toLowerCase().includes('bedrock') ?? false;
    const modelId = selectedModel?.value?.toLowerCase() ?? '';
    const isClaude45 =
      modelId.includes('sonnet-4-5') ||
      modelId.includes('haiku-4-5') ||
      modelId.includes('opus-4-5');
    return isBedrockProvider && isClaude45;
  }, [selectedModel]);

  const handleClearHistory = React.useCallback(async () => {
    try {
      await fetch('/api/clear-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
      setMessages([]);
      setStreamingMessage(null);
      // Reset conversation ID to start fresh
      setInternalConversationId(null);
      onConversationChange?.(null);
    } catch (error) {
      console.error('Error clearing history:', error);
    }
  }, [sessionId, onConversationChange]);

  // Expose clear history function to parent
  useEffect(() => {
    if (onClearHistoryRef) {
      onClearHistoryRef.current = handleClearHistory;
    }
  }, [onClearHistoryRef, handleClearHistory]);

  // Auto-scroll to bottom when messages change
  const lastMessageContent = streamingMessage?.content || messages[messages.length - 1]?.content;

  useEffect(() => {
    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }, 0);
  }, [lastMessageContent]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    setStreamingMessage(null);
  }, [selectedModel]);

  // Clear previous prompt when input changes manually
  useEffect(() => {
    if (previousPrompt && inputValue !== previousPrompt) {
      setPreviousPrompt(null);
    }
  }, [inputValue, previousPrompt]);

  const handleOptimizeClick = () => {
    setShowOptimizeModal(true);
  };

  const handleOptimizeConfirm = async () => {
    const currentPrompt = inputValue;
    const result = await optimize(currentPrompt);

    if (result.success && result.optimizedPrompt) {
      setPreviousPrompt(currentPrompt);
      setInputValue(result.optimizedPrompt);
      setShowOptimizeModal(false);
    }
  };

  const handleOptimizeCancel = () => {
    setShowOptimizeModal(false);
  };

  const handleUndoOptimization = () => {
    if (previousPrompt) {
      setInputValue(previousPrompt);
      setPreviousPrompt(null);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamingMessage(null);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !selectedModel || isLoading) return;

    const provider = getProviderFromModel(selectedModel);
    const modelId = selectedModel.value || '';
    const modelName = selectedModel.label || modelId;

    // Create conversation if this is the first message
    let currentConversationId = activeConversationId;
    if (!currentConversationId) {
      const newConversation = await createConversation();
      currentConversationId = newConversation.id;
      setInternalConversationId(currentConversationId);
      onConversationChange?.(currentConversationId);
    }

    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: inputValue,
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Persist user message to DB
    const userSequence = await getNextSequence(currentConversationId);
    await addMessage({
      conversationId: currentConversationId,
      role: 'user',
      content: userMessage.content,
      sequence: userSequence,
      createdAt: new Date(),
      provider,
      modelId,
      modelName,
      parameters: {
        temperature,
        topP,
        maxTokens,
      },
    });

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    const streamingId = Date.now() + 1;
    setStreamingMessage({
      id: streamingId,
      role: 'assistant',
      content: '',
    });

    try {
      // Import API service and file utilities
      const { apiService } = await import('../../services');
      const { processFilesForBedrock } = await import('../../utils/fileUtils');

      // Process files if any (only for Bedrock)
      let processedFiles: Array<{
        name: string;
        format: string;
        bytes: string;
      }> = [];
      if (files.length > 0 && provider === 'bedrock') {
        const { processedFiles: processed, errors } = await processFilesForBedrock(files);

        if (errors.length > 0) {
          // Show error for file validation failures
          const errorMessages = errors.map((e) => e.error).join('\n');
          setError({
            type: 'error',
            title: 'File Upload Error',
            content: errorMessages,
          });
          setIsLoading(false);
          setStreamingMessage(null);
          return;
        }

        processedFiles = processed;
        console.log(`Bedrock: Processed ${processedFiles.length} files for upload`);
      } else if (files.length > 0) {
        console.log(`File upload not supported for ${provider}`);
      }

      // Build chat history
      const chatMessages: Array<{
        role: 'user' | 'assistant';
        content: string;
        files?: Array<{
          name: string;
          format: string;
          bytes: string;
        }>;
      }> = [
        ...messages.map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
      ];

      // Add current message with files if present
      if (processedFiles.length > 0) {
        chatMessages.push({
          role: 'user' as const,
          content: userMessage.content,
          files: processedFiles,
        });
      } else {
        chatMessages.push({
          role: 'user' as const,
          content: userMessage.content,
        });
      }

      let fullContent = '';
      let capturedUsage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        latencyMs?: number;
      } | null = null;

      // For Claude 4.5 models, only send the selected sampling parameter
      const modelIdLower = (selectedModel.value || '').toLowerCase();
      const isClaude45 =
        modelIdLower.includes('sonnet-4-5') ||
        modelIdLower.includes('haiku-4-5') ||
        modelIdLower.includes('opus-4-5');

      const chatRequest = {
        model: selectedModel.value || '',
        messages: chatMessages,
        max_tokens: maxTokens,
        stream: true,
        signal: abortControllerRef.current?.signal,
        // For Claude 4.5, only send the selected parameter; for others, send both
        ...(isClaude45
          ? samplingParameter === 'temperature'
            ? { temperature }
            : { top_p: topP }
          : { temperature, top_p: topP }),
      };

      // Stream the response
      for await (const chunk of apiService.chat(provider, chatRequest)) {
        // Check if this is Bedrock metadata
        if (chunk.startsWith('__BEDROCK_METADATA__')) {
          try {
            const metadataJson = chunk.replace('__BEDROCK_METADATA__', '');
            const metadata = JSON.parse(metadataJson);

            // Extract usage information
            if (metadata.usage) {
              capturedUsage = {
                inputTokens: metadata.usage.inputTokens,
                outputTokens: metadata.usage.outputTokens,
                totalTokens: metadata.usage.totalTokens,
                latencyMs: metadata.metrics?.latencyMs,
              };
              setBedrockMetadata(capturedUsage);
            }
          } catch (e) {
            console.error('Failed to parse Bedrock metadata:', e);
          }
          continue;
        }

        // Check if this is Mantle metadata (same format as Bedrock)
        if (chunk.startsWith('__MANTLE_METADATA__')) {
          try {
            const metadataJson = chunk.replace('__MANTLE_METADATA__', '');
            const metadata = JSON.parse(metadataJson);

            // Extract usage information
            if (metadata.usage) {
              capturedUsage = {
                inputTokens: metadata.usage.inputTokens,
                outputTokens: metadata.usage.outputTokens,
                totalTokens: metadata.usage.totalTokens,
              };
              setBedrockMetadata(capturedUsage);
            }
          } catch (e) {
            console.error('Failed to parse Mantle metadata:', e);
          }
          continue;
        }

        // Check if this is LM Studio metadata
        if (chunk.startsWith('__LMSTUDIO_METADATA__')) {
          try {
            const metadataJson = chunk.replace('__LMSTUDIO_METADATA__', '');
            const metadata = JSON.parse(metadataJson);

            // Extract usage and latency information
            if (metadata.usage || metadata.latencyMs) {
              capturedUsage = {
                inputTokens: metadata.usage?.promptTokens,
                outputTokens: metadata.usage?.completionTokens,
                totalTokens: metadata.usage?.totalTokens,
                latencyMs: metadata.latencyMs,
              };
              setLmstudioMetadata({
                promptTokens: metadata.usage?.promptTokens,
                completionTokens: metadata.usage?.completionTokens,
                totalTokens: metadata.usage?.totalTokens,
                latencyMs: metadata.latencyMs,
              });
            }
          } catch (e) {
            console.error('Failed to parse LM Studio metadata:', e);
          }
          continue;
        }

        // Check if this is Ollama metadata
        if (chunk.startsWith('__OLLAMA_METADATA__')) {
          try {
            const metadataJson = chunk.replace('__OLLAMA_METADATA__', '');
            const metadata = JSON.parse(metadataJson);

            // Extract usage and latency information
            if (metadata.usage || metadata.latencyMs) {
              capturedUsage = {
                inputTokens: metadata.usage?.promptTokens,
                outputTokens: metadata.usage?.completionTokens,
                totalTokens: metadata.usage?.totalTokens,
                latencyMs: metadata.latencyMs,
              };
              setLmstudioMetadata({
                promptTokens: metadata.usage?.promptTokens,
                completionTokens: metadata.usage?.completionTokens,
                totalTokens: metadata.usage?.totalTokens,
                latencyMs: metadata.latencyMs,
              });
            }
          } catch (e) {
            console.error('Failed to parse Ollama metadata:', e);
          }
          continue;
        }

        // Check if this is AI SDK metadata (Groq, Cerebras)
        if (chunk.startsWith('__AISDK_METADATA__')) {
          try {
            const metadataJson = chunk.replace('__AISDK_METADATA__', '');
            const metadata = JSON.parse(metadataJson);

            // Extract usage and latency information
            if (metadata.usage || metadata.latencyMs) {
              capturedUsage = {
                inputTokens: metadata.usage?.promptTokens,
                outputTokens: metadata.usage?.completionTokens,
                totalTokens: metadata.usage?.totalTokens,
                latencyMs: metadata.latencyMs,
              };
              setLmstudioMetadata({
                promptTokens: metadata.usage?.promptTokens,
                completionTokens: metadata.usage?.completionTokens,
                totalTokens: metadata.usage?.totalTokens,
                latencyMs: metadata.latencyMs,
              });
            }
          } catch (e) {
            console.error('Failed to parse AI SDK metadata:', e);
          }
          continue;
        }

        fullContent += chunk;
        setStreamingMessage({
          id: streamingId,
          role: 'assistant',
          content: fullContent,
        });
      }

      setMessages((prevMessages) => [
        ...prevMessages,
        {
          id: streamingId,
          role: 'assistant',
          content: fullContent,
        },
      ]);

      // Persist assistant message to DB
      const assistantSequence = await getNextSequence(currentConversationId);
      await addMessage({
        conversationId: currentConversationId,
        role: 'assistant',
        content: fullContent,
        sequence: assistantSequence,
        createdAt: new Date(),
        provider,
        modelId,
        modelName,
        parameters: {
          temperature,
          topP,
          maxTokens,
        },
        usage: capturedUsage || undefined,
      });

      setStreamingMessage(null);
    } catch (error) {
      // Check if error was due to abort
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation stopped by user');
        // Keep the partial message if any
        if (streamingMessage && streamingMessage.content) {
          setMessages((prevMessages) => [...prevMessages, streamingMessage]);
        }
        setStreamingMessage(null);
        return;
      }

      console.error('Error sending message or fetching bot response:', error);

      const errorMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Error: ${(error as Error).message || 'Could not connect to the AI service. Make sure LMStudio or Ollama is running.'}`,
      };

      setMessages((prevMessages) => [...prevMessages, errorMessage]);
      setStreamingMessage(null);

      // Use Flashbar callback for connection errors if available
      const connectionError = {
        title: 'Connection Error',
        content:
          'Failed to connect to the chat service. Please ensure LMStudio (port 1234) or Ollama (port 11434) is running.',
      };

      if (onConnectionError) {
        onConnectionError(connectionError);
      } else {
        setError({
          type: 'error',
          ...connectionError,
        });
      }
    } finally {
      setIsLoading(false);
      setFiles([]);
      abortControllerRef.current = null;
    }
  };

  return (
    <>
      {error && (
        <Alert type={error.type} dismissible onDismiss={() => setError(null)} header={error.title}>
          {error.content || 'An error occurred'}
        </Alert>
      )}

      {optimizeError && (
        <Alert type="error" dismissible onDismiss={clearOptimizeError} header="Optimization Error">
          {optimizeError}
        </Alert>
      )}

      {previousPrompt && (
        <Alert
          type="success"
          dismissible
          onDismiss={() => setPreviousPrompt(null)}
          header="Prompt Optimized"
          action={
            <Button onClick={handleUndoOptimization} variant="link">
              Undo
            </Button>
          }
        >
          Your prompt has been optimized. Click Undo to restore the original.
        </Alert>
      )}

      <OptimizePromptModal
        visible={showOptimizeModal}
        onDismiss={handleOptimizeCancel}
        onConfirm={handleOptimizeConfirm}
        isOptimizing={isOptimizing}
      />

      <div className="chat-content-wrapper">
        {/* Header */}
        <div className="chat-header">
          <Box padding={{ horizontal: 'l', vertical: 's' }}>
            {selectedModel ? (
              <SpaceBetween size="xxs">
                <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                  {/* Provider Icon */}
                  {selectedModel.description?.toLowerCase().includes('bedrock-mantle') ? (
                    <img
                      src="/bedrock-color.svg"
                      alt="Bedrock Mantle"
                      style={{ width: '24px', height: '24px' }}
                    />
                  ) : selectedModel.description?.toLowerCase().includes('bedrock') ? (
                    <img
                      src="/bedrock_bw.svg"
                      alt="Amazon Bedrock"
                      style={{ width: '24px', height: '24px' }}
                    />
                  ) : selectedModel.description?.toLowerCase().includes('lmstudio') ? (
                    <img
                      src="/lmstudio_icon.svg"
                      alt="LM Studio"
                      style={{ width: '24px', height: '24px' }}
                    />
                  ) : selectedModel.description?.toLowerCase().includes('ollama') ? (
                    <img
                      src="/ollama_icon.svg"
                      alt="Ollama"
                      style={{ width: '24px', height: '24px' }}
                    />
                  ) : selectedModel.description?.toLowerCase().includes('groq') ? (
                    <img
                      src="/groq_icon.svg"
                      alt="Groq"
                      style={{ width: '24px', height: '24px' }}
                    />
                  ) : selectedModel.description?.toLowerCase().includes('cerebras') ? (
                    <img
                      src="/cerebras_icon.svg"
                      alt="Cerebras"
                      style={{ width: '24px', height: '24px' }}
                    />
                  ) : (
                    <Icon name="contact" size="medium" />
                  )}

                  {/* Provider Name */}
                  <Box variant="h3" fontWeight="bold">
                    {selectedModel.description?.toLowerCase().includes('bedrock-mantle')
                      ? 'Bedrock Mantle'
                      : selectedModel.description?.toLowerCase().includes('bedrock')
                        ? 'Amazon Bedrock'
                        : selectedModel.description?.toLowerCase().includes('lmstudio')
                          ? 'LM Studio'
                          : selectedModel.description?.toLowerCase().includes('ollama')
                            ? 'Ollama'
                            : selectedModel.description?.toLowerCase().includes('groq')
                              ? 'Groq'
                              : selectedModel.description?.toLowerCase().includes('cerebras')
                                ? 'Cerebras'
                                : 'Chat'}
                  </Box>

                  {showOptimizeButton && (
                    <span className="optimize-available-badge">
                      <Icon name="gen-ai" size="small" />
                      <span>Optimizer</span>
                    </span>
                  )}
                </SpaceBetween>

                {/* Model Name */}
                <Box variant="small" color="text-body-secondary" padding={{ left: 'xxxl' }}>
                  {selectedModel.label}
                </Box>
              </SpaceBetween>
            ) : (
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <Icon name="contact" size="medium" />
                <Box variant="h3">Chat</Box>
              </SpaceBetween>
            )}
          </Box>
        </div>

        {/* Messages Area */}
        <FittedContainer>
          <ScrollableContainer ref={scrollContainerRef}>
            <div className="chat-messages-padding">
              {messages.length === 0 ? (
                <div className="empty-state-container">
                  <SpaceBetween size="l" alignItems="center">
                    {selectedModel ? (
                      <>
                        <Box>
                          {selectedModel.description?.toLowerCase().includes('ollama') && (
                            <img src="/ollama_icon.svg" alt="Ollama" className="provider-icon" />
                          )}
                          {selectedModel.description?.toLowerCase().includes('lmstudio') && (
                            <img
                              src="/lmstudio_icon.svg"
                              alt="LM Studio"
                              className="provider-icon"
                            />
                          )}
                          {selectedModel.description?.toLowerCase().includes('bedrock') && (
                            <img
                              src="/bedrock_bw.svg"
                              alt="Amazon Bedrock"
                              className="provider-icon"
                            />
                          )}
                          {selectedModel.description?.toLowerCase().includes('groq') && (
                            <img src="/groq_icon.svg" alt="Groq" className="provider-icon" />
                          )}
                          {selectedModel.description?.toLowerCase().includes('cerebras') && (
                            <img
                              src="/cerebras_icon.svg"
                              alt="Cerebras"
                              className="provider-icon"
                            />
                          )}
                        </Box>
                        <SpaceBetween size="xs" alignItems="center">
                          <Box variant="h3" color="text-body-secondary">
                            Ready to chat
                          </Box>
                          <Box color="text-body-secondary" textAlign="center">
                            Send a message to start chatting with{' '}
                            <strong>{selectedModel.label}</strong>
                          </Box>
                        </SpaceBetween>
                      </>
                    ) : (
                      <>
                        <Box color="text-status-inactive">
                          <Icon name="contact" size="big" />
                        </Box>
                        <SpaceBetween size="xs" alignItems="center">
                          <Box variant="h3" color="text-body-secondary">
                            No model selected
                          </Box>
                          <Box color="text-body-secondary">
                            Select a model from the sidebar to begin
                          </Box>
                        </SpaceBetween>
                      </>
                    )}
                  </SpaceBetween>
                </div>
              ) : (
                <Box padding="s">
                  <MessageList
                    messages={messages}
                    streamingMessage={streamingMessage}
                    avatarInitials={avatarInitials}
                    lastMessageMetadata={
                      selectedModel?.description?.toLowerCase().includes('bedrock-mantle')
                        ? bedrockMetadata
                        : selectedModel?.description?.toLowerCase().includes('bedrock')
                          ? bedrockMetadata
                          : selectedModel?.description?.toLowerCase().includes('lmstudio')
                            ? lmstudioMetadata
                            : selectedModel?.description?.toLowerCase().includes('ollama')
                              ? lmstudioMetadata
                              : selectedModel?.description?.toLowerCase().includes('groq')
                                ? lmstudioMetadata
                                : selectedModel?.description?.toLowerCase().includes('cerebras')
                                  ? lmstudioMetadata
                                  : null
                    }
                  />
                </Box>
              )}
            </div>
          </ScrollableContainer>
        </FittedContainer>
      </div>

      {/* Floating Input Panel */}
      <FloatingChatInput
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        isLoading={isLoading}
        selectedModel={selectedModel}
        onFilesChange={setFiles}
        maxTokens={maxTokens}
        setMaxTokens={setMaxTokens}
        temperature={temperature}
        setTemperature={setTemperature}
        topP={topP}
        setTopP={setTopP}
        samplingParameter={samplingParameter}
        setSamplingParameter={setSamplingParameter}
        showOptimizeButton={showOptimizeButton}
        onOptimizePrompt={handleOptimizeClick}
        isOptimizing={isOptimizing}
        modelStatus={modelStatus}
        onDismissModelStatus={onDismissModelStatus}
        onClearConversation={handleClearHistory}
        hasMessages={messages.length > 0}
      />
    </>
  );
};

export default ChatContainer;
