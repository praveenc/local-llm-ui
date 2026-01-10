'use client';

import { Bot } from 'lucide-react';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { SelectProps } from '@cloudscape-design/components';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { FittedContainer, ScrollableContainer } from '../../components/layout';
import type { Provider } from '../../db';
import {
  useConversation,
  useConversationMutations,
  usePromptMutations,
  usePromptOptimizer,
  useSavedPrompts,
} from '../../hooks';
import { SavePromptModal } from '../prompts';
import AIChatInput from './AIChatInput';
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
  selectedProvider?: Provider;
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

// Helper to determine provider from model description (fallback)
const getProviderFromModel = (model: SelectProps.Option | null): Provider => {
  if (model?.description?.toLowerCase().includes('ollama')) return 'ollama';
  if (model?.description?.toLowerCase().includes('bedrock-mantle')) return 'bedrock-mantle';
  if (model?.description?.toLowerCase().includes('bedrock')) return 'bedrock';
  if (model?.description?.toLowerCase().includes('groq')) return 'groq';
  if (model?.description?.toLowerCase().includes('cerebras')) return 'cerebras';
  return 'lmstudio';
};

// Helper to get provider info
const getProviderInfo = (model: SelectProps.Option | null) => {
  const desc = model?.description?.toLowerCase() ?? '';
  if (desc.includes('bedrock-mantle'))
    return { icon: '/bedrock-color.svg', name: 'Bedrock Mantle' };
  if (desc.includes('bedrock')) return { icon: '/bedrock_bw.svg', name: 'Amazon Bedrock' };
  if (desc.includes('lmstudio')) return { icon: '/lmstudio_icon.svg', name: 'LM Studio' };
  if (desc.includes('ollama')) return { icon: '/ollama_icon.svg', name: 'Ollama' };
  if (desc.includes('groq')) return { icon: '/groq_icon.svg', name: 'Groq' };
  if (desc.includes('cerebras')) return { icon: '/cerebras_icon.svg', name: 'Cerebras' };
  return null;
};

const ChatContainer = ({
  selectedModel,
  selectedProvider: selectedProviderProp,
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
  // Use provided provider or fall back to detection from model description
  const selectedProvider = selectedProviderProp ?? getProviderFromModel(selectedModel);

  const [inputValue, setInputValue] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
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
  const { createConversation, addMessage, getNextSequence, deleteMessagesFromSequence } =
    useConversationMutations();

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

  // Save prompt state
  const [showSavePromptModal, setShowSavePromptModal] = useState(false);
  const [promptToSave, setPromptToSave] = useState('');
  const { categories } = useSavedPrompts();
  const { savePrompt } = usePromptMutations();

  const handleSavePromptClick = (content: string) => {
    setPromptToSave(content);
    setShowSavePromptModal(true);
  };

  const handleSavePrompt = async (name: string, category: string) => {
    await savePrompt(name, promptToSave, category);
    setShowSavePromptModal(false);
    setPromptToSave('');
  };

  const handleSavePromptDismiss = () => {
    setShowSavePromptModal(false);
    setPromptToSave('');
  };

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

  // Handle regenerating a response - finds the preceding user message and re-sends it
  const handleRegenerate = async (assistantMessageIndex: number) => {
    if (isLoading || !selectedModel) return;

    // Find the user message that preceded this assistant message
    let userMessageIndex = -1;
    for (let i = assistantMessageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }

    if (userMessageIndex === -1) {
      console.error('Could not find user message to regenerate from');
      return;
    }

    const userMessage = messages[userMessageIndex];

    // Remove all messages from the assistant message onwards (keep up to and including user message)
    // This removes the assistant response we're regenerating AND any subsequent messages
    const newMessages = messages.slice(0, userMessageIndex + 1);

    // Delete messages from DB starting from the assistant message's sequence
    // The sequence in DB is 1-based and corresponds to message index + 1
    // We want to delete from assistantMessageIndex + 1 (the sequence of the assistant message)
    if (activeConversationId) {
      const fromSequence = assistantMessageIndex + 1; // Convert 0-based index to 1-based sequence
      await deleteMessagesFromSequence(activeConversationId, fromSequence);
    }

    // Update local state - use flushSync to ensure UI updates immediately
    flushSync(() => {
      setMessages(newMessages);
    });

    // Directly call the regeneration logic with the trimmed message history
    await handleSendMessageForRegenerate(userMessage.content, newMessages);
  };

  // Internal function to regenerate a response with specific message history
  const handleSendMessageForRegenerate = async (content: string, messageHistory: Message[]) => {
    if (!content.trim() || !selectedModel) return;

    const provider = selectedProvider;
    const modelId = selectedModel.value || '';
    const modelName = selectedModel.label || modelId;

    // Use existing conversation
    const currentConversationId = activeConversationId;
    if (!currentConversationId) {
      console.error('No conversation ID for regeneration');
      return;
    }

    setIsLoading(true);

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    const streamingId = Date.now() + 1;
    setStreamingMessage({
      id: streamingId,
      role: 'assistant',
      content: '',
    });

    try {
      // Import API service
      const { apiService } = await import('../../services');

      // Build chat history - messageHistory already includes the user message
      const chatMessages: Array<{
        role: 'user' | 'assistant';
        content: string;
      }> = messageHistory.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }));

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
        ...(isClaude45
          ? samplingParameter === 'temperature'
            ? { temperature }
            : { top_p: topP }
          : { temperature, top_p: topP }),
      };

      // Stream the response
      for await (const chunk of apiService.chat(provider, chatRequest)) {
        // Handle metadata chunks
        if (
          chunk.startsWith('__BEDROCK_METADATA__') ||
          chunk.startsWith('__MANTLE_METADATA__') ||
          chunk.startsWith('__LMSTUDIO_METADATA__') ||
          chunk.startsWith('__OLLAMA_METADATA__') ||
          chunk.startsWith('__AISDK_METADATA__')
        ) {
          try {
            const metadataJson = chunk.replace(/^__[A-Z_]+__/, '');
            const metadata = JSON.parse(metadataJson);
            if (metadata.usage) {
              capturedUsage = {
                inputTokens: metadata.usage.inputTokens ?? metadata.usage.promptTokens,
                outputTokens: metadata.usage.outputTokens ?? metadata.usage.completionTokens,
                totalTokens: metadata.usage.totalTokens,
                latencyMs: metadata.metrics?.latencyMs ?? metadata.latencyMs,
              };
              if (
                chunk.startsWith('__BEDROCK_METADATA__') ||
                chunk.startsWith('__MANTLE_METADATA__')
              ) {
                setBedrockMetadata(capturedUsage);
              } else {
                setLmstudioMetadata({
                  promptTokens: capturedUsage.inputTokens,
                  completionTokens: capturedUsage.outputTokens,
                  totalTokens: capturedUsage.totalTokens,
                  latencyMs: capturedUsage.latencyMs,
                });
              }
            }
          } catch (e) {
            console.error('Failed to parse metadata:', e);
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

      // Add the new assistant message to the trimmed history (not using prevMessages!)
      setMessages([
        ...messageHistory,
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
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation stopped by user');
        if (streamingMessage && streamingMessage.content) {
          setMessages([...messageHistory, streamingMessage]);
        }
        setStreamingMessage(null);
        return;
      }

      console.error('Error regenerating response:', error);
      const errorMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Error: ${(error as Error).message || 'Could not regenerate response.'}`,
      };
      setMessages([...messageHistory, errorMessage]);
      setStreamingMessage(null);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleSendMessage = async (message: { text: string; files?: File[] }) => {
    if (!message.text.trim() || !selectedModel || isLoading) return;

    const provider = selectedProvider;
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
      content: message.text,
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
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
      const messageFiles = message.files || [];
      if (messageFiles.length > 0 && provider === 'bedrock') {
        const { processedFiles: processed, errors } = await processFilesForBedrock(messageFiles);

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
      } else if (messageFiles.length > 0) {
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
      abortControllerRef.current = null;
    }
  };

  const providerInfo = getProviderInfo(selectedModel);

  // Get metadata based on provider
  const getMetadata = () => {
    if (selectedProvider === 'bedrock' || selectedProvider === 'bedrock-mantle') {
      return bedrockMetadata;
    }
    return lmstudioMetadata;
  };

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.content || 'An error occurred'}</AlertDescription>
        </Alert>
      )}

      {optimizeError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Optimization Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{optimizeError}</span>
            <Button variant="ghost" size="sm" onClick={clearOptimizeError} className="h-auto p-1">
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {previousPrompt && (
        <Alert className="mb-4">
          <AlertTitle>Prompt Optimized</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>Your prompt has been optimized. Click Undo to restore the original.</span>
            <Button variant="link" onClick={handleUndoOptimization} className="p-0 h-auto">
              Undo
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <OptimizePromptModal
        visible={showOptimizeModal}
        onDismiss={handleOptimizeCancel}
        onConfirm={handleOptimizeConfirm}
        isOptimizing={isOptimizing}
      />

      <SavePromptModal
        visible={showSavePromptModal}
        onDismiss={handleSavePromptDismiss}
        onSave={handleSavePrompt}
        promptContent={promptToSave}
        existingCategories={categories}
      />

      <div className="relative flex flex-col h-full">
        {/* Messages Area */}
        <FittedContainer>
          <ScrollableContainer ref={scrollContainerRef}>
            <div className="p-4 pb-44">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
                  {selectedModel ? (
                    <>
                      {providerInfo && (
                        <img
                          src={providerInfo.icon}
                          alt={providerInfo.name}
                          className="w-16 h-16 opacity-50"
                        />
                      )}
                      <div className="text-center">
                        <h3 className="text-lg font-medium text-muted-foreground">Ready to chat</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Send a message to start chatting with{' '}
                          <strong>{selectedModel.label}</strong>
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Bot className="h-16 w-16 text-muted-foreground/50" />
                      <div className="text-center">
                        <h3 className="text-lg font-medium text-muted-foreground">
                          No model selected
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Select a model from the sidebar to begin
                        </p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <MessageList
                  messages={messages}
                  streamingMessage={streamingMessage}
                  avatarInitials={avatarInitials}
                  lastMessageMetadata={getMetadata()}
                  onRegenerate={handleRegenerate}
                  isLoading={isLoading}
                  onSavePrompt={handleSavePromptClick}
                />
              )}
            </div>
          </ScrollableContainer>
        </FittedContainer>

        {/* Floating Input Panel - positioned within the chat container */}
        <AIChatInput
          onSubmit={handleSendMessage}
          status={isLoading ? 'streaming' : 'idle'}
          selectedModel={selectedModel}
          maxTokens={maxTokens}
          setMaxTokens={setMaxTokens}
          temperature={temperature}
          setTemperature={setTemperature}
          topP={topP}
          setTopP={setTopP}
          samplingParameter={samplingParameter}
          setSamplingParameter={setSamplingParameter}
          inputValue={inputValue}
          onInputValueChange={setInputValue}
          showOptimizeButton={showOptimizeButton}
          onOptimizePrompt={handleOptimizeClick}
          isOptimizing={isOptimizing}
          onStopGeneration={handleStopGeneration}
          onClearConversation={handleClearHistory}
          hasMessages={messages.length > 0}
          modelStatus={modelStatus}
          onDismissModelStatus={onDismissModelStatus}
        />
      </div>
    </>
  );
};

export default ChatContainer;
