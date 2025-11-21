'use client';

import React, { useEffect, useRef, useState } from 'react';

import {
  Alert,
  Badge,
  Box,
  Container,
  ExpandableSection,
  Header,
  KeyValuePairs,
  SpaceBetween,
} from '@cloudscape-design/components';
import type { SelectProps } from '@cloudscape-design/components';

import { FittedContainer, ScrollableContainer } from '../../components/layout';
import ChatInputPanel from './ChatInputPanel';
import MessageList from './MessageList';

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

interface ChatContainerProps {
  selectedModel: SelectProps.Option | null;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  onClearHistoryRef?: React.MutableRefObject<(() => void) | null>;
}

const ChatContainer = ({
  selectedModel,
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature,
  topP,
  setTopP,
  onClearHistoryRef,
}: ChatContainerProps) => {
  const [inputValue, setInputValue] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sessionId] = useState<string>(
    () => `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  const [bedrockMetadata, setBedrockMetadata] = useState<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    } catch (error) {
      console.error('Error clearing history:', error);
    }
  }, [sessionId]);

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

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !selectedModel || isLoading) return;

    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: inputValue,
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue('');
    setIsLoading(true);

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

      // Determine provider from model description
      let provider: 'ollama' | 'lmstudio' | 'bedrock';
      if (selectedModel.description?.toLowerCase().includes('ollama')) {
        provider = 'ollama';
      } else if (selectedModel.description?.toLowerCase().includes('bedrock')) {
        provider = 'bedrock';
      } else {
        provider = 'lmstudio';
      }

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
      const chatMessages = [
        ...messages.map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
        {
          role: 'user' as const,
          content: userMessage.content,
          files: processedFiles.length > 0 ? processedFiles : undefined,
        },
      ];

      let fullContent = '';

      // Stream the response
      for await (const chunk of apiService.chat(provider, {
        model: selectedModel.value || '',
        messages: chatMessages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        stream: true,
      })) {
        // Check if this is Bedrock metadata
        if (chunk.startsWith('__BEDROCK_METADATA__')) {
          try {
            const metadataJson = chunk.replace('__BEDROCK_METADATA__', '');
            const metadata = JSON.parse(metadataJson);

            // Extract usage information
            if (metadata.usage) {
              setBedrockMetadata({
                inputTokens: metadata.usage.inputTokens,
                outputTokens: metadata.usage.outputTokens,
                totalTokens: metadata.usage.totalTokens,
                latencyMs: metadata.metrics?.latencyMs,
              });
            }
          } catch (e) {
            console.error('Failed to parse Bedrock metadata:', e);
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

      setStreamingMessage(null);
    } catch (error) {
      console.error('Error sending message or fetching bot response:', error);

      const errorMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Error: ${(error as Error).message || 'Could not connect to the AI service. Make sure LMStudio or Ollama is running.'}`,
      };

      setMessages((prevMessages) => [...prevMessages, errorMessage]);
      setStreamingMessage(null);

      setError({
        type: 'error',
        title: 'Connection Error',
        content:
          'Failed to connect to the chat service. Please ensure LMStudio (port 1234) or Ollama (port 11434) is running.',
      });
    } finally {
      setIsLoading(false);
      setFiles([]);
    }
  };

  return (
    <>
      {error && (
        <Alert type={error.type} dismissible onDismiss={() => setError(null)} header={error.title}>
          {error.content || 'An error occurred'}
        </Alert>
      )}

      <FittedContainer>
        <Container
          header={<Header variant="h2">Chat 💬</Header>}
          fitHeight
          disableContentPaddings={false}
          footer={
            <Box padding="m">
              <ChatInputPanel
                inputValue={inputValue}
                onInputValueChange={setInputValue}
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
                selectedModel={selectedModel}
                onFilesChange={setFiles}
                maxTokens={maxTokens}
                setMaxTokens={setMaxTokens}
                temperature={temperature}
                setTemperature={setTemperature}
                topP={topP}
                setTopP={setTopP}
              />
              <SpaceBetween size="s">
                <Box fontSize="body-s" color="text-body-secondary">
                  <SpaceBetween direction="horizontal" size="l">
                    <span>
                      🌡️ Temperature: <strong>{temperature.toFixed(1)}</strong>
                    </span>
                    <span>
                      🎯 Top P: <strong>{topP.toFixed(1)}</strong>
                    </span>
                    <span>
                      📊 Max Tokens: <strong>{maxTokens.toLocaleString()}</strong>
                    </span>
                  </SpaceBetween>
                </Box>

                {bedrockMetadata &&
                  selectedModel?.description?.toLowerCase().includes('bedrock') && (
                    <ExpandableSection
                      variant="footer"
                      headerText={
                        <Box fontSize="body-s">
                          <SpaceBetween direction="horizontal" size="xs">
                            <span>📈 Usage Metrics</span>
                            <Badge color="green">
                              💎 Total tokens: {bedrockMetadata.totalTokens?.toLocaleString() || 0}
                            </Badge>
                          </SpaceBetween>
                        </Box>
                      }
                    >
                      <Box padding={{ top: 'xs' }}>
                        <KeyValuePairs
                          columns={4}
                          items={[
                            {
                              label: '⬇️ Input',
                              value: bedrockMetadata.inputTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '⬆️ Output',
                              value: bedrockMetadata.outputTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '💎 Total',
                              value: bedrockMetadata.totalTokens?.toLocaleString() || '0',
                            },
                            {
                              label: '⚡ Latency',
                              value: bedrockMetadata.latencyMs
                                ? `${bedrockMetadata.latencyMs}ms`
                                : 'N/A',
                            },
                          ]}
                        />
                      </Box>
                    </ExpandableSection>
                  )}
              </SpaceBetween>
            </Box>
          }
        >
          <ScrollableContainer ref={scrollContainerRef}>
            <Box padding="s">
              {messages.length === 0 ? (
                <Box color="text-body-secondary" textAlign="center" padding="l">
                  {selectedModel ? (
                    <SpaceBetween size="m" alignItems="center">
                      <Box fontSize="display-l">
                        {selectedModel.description?.toLowerCase().includes('ollama') && (
                          <img
                            src="/ollama_icon.svg"
                            alt="Ollama"
                            style={{ width: '48px', height: '48px' }}
                          />
                        )}
                        {selectedModel.description?.toLowerCase().includes('lmstudio') && (
                          <img
                            src="/lmstudio_icon.svg"
                            alt="LM Studio"
                            style={{ width: '48px', height: '48px' }}
                          />
                        )}
                        {selectedModel.description?.toLowerCase().includes('bedrock') && (
                          <img
                            src="/bedrock-color.svg"
                            alt="Amazon Bedrock"
                            style={{ width: '48px', height: '48px' }}
                          />
                        )}
                      </Box>
                      <Box variant="p">
                        Send a message to start chatting with <strong>{selectedModel.label}</strong>
                      </Box>
                      <Box variant="small" color="text-body-secondary">
                        Provider: {selectedModel.description?.replace('Provider: ', '')}
                      </Box>
                    </SpaceBetween>
                  ) : (
                    'Please select a model from the sidebar to start chatting.'
                  )}
                </Box>
              ) : (
                <MessageList messages={messages} streamingMessage={streamingMessage} />
              )}
            </Box>
          </ScrollableContainer>
        </Container>
      </FittedContainer>

      <style>{`
        .inline-code {
          background-color: var(--color-background-code-inline);
          border-radius: 3px;
          padding: 0.2em 0.4em;
          font-family: monospace;
          font-size: 85%;
        }

        .code-block-container {
          position: relative;
          margin: 1em 0;
        }

        .code-block {
          display: block;
          overflow-x: auto;
          padding: 1em;
          background-color: var(--color-background-code-block);
          border-radius: 4px;
          font-family: monospace;
          white-space: pre;
          color: var(--color-text-body-default);
        }

        .cursor {
          display: inline-block;
          width: 0.5em;
          height: 1em;
          background-color: var(--color-text-body-default);
          animation: blink 1s step-end infinite;
        }

        @keyframes blink {
          from, to { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </>
  );
};

export default ChatContainer;
