/**
 * useBedrockChat Hook
 *
 * Custom hook for managing chat with AI SDK streaming.
 * Handles message state, streaming, and conversation persistence.
 * Supports Bedrock, Bedrock Mantle, Groq, and Cerebras providers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Provider } from '../db/types';
import { mantleService } from '../services';
import type { ModelOption } from '../types';
import type { MessagePart, UIMessage } from '../types/ai-messages';
import { createUIMessage, getTextContent, toUIMessages } from '../types/ai-messages';
import { loadPreferences } from '../utils/preferences';
import { useConversation, useConversationMutations } from './index';

export type ChatStatus = 'idle' | 'streaming' | 'submitted' | 'error';

interface UseBedrockChatOptions {
  conversationId: string | null;
  selectedModel: ModelOption | null;
  temperature: number;
  topP: number;
  maxTokens: number;
  samplingParameter: 'temperature' | 'topP';
  enableWebSearch?: boolean;
  onConversationChange?: (id: string | null) => void;
}

interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface UseBedrockChatReturn {
  messages: UIMessage[];
  status: ChatStatus;
  error: string | null;
  metadata: UsageMetadata | null;
  cumulativeUsage: CumulativeUsage;
  wasInterrupted: boolean;
  sendMessage: (
    content: string,
    files?: Array<{ name: string; format: string; bytes: string }>
  ) => Promise<void>;
  regenerate: (messageIndex: number) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
  resetUsage: () => void;
}

export function useBedrockChat({
  conversationId: externalConversationId,
  selectedModel,
  temperature,
  topP,
  maxTokens,
  samplingParameter,
  enableWebSearch = false,
  onConversationChange,
}: UseBedrockChatOptions): UseBedrockChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<UsageMetadata | null>(null);
  const [cumulativeUsage, setCumulativeUsage] = useState<CumulativeUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
  const [internalConversationId, setInternalConversationId] = useState<string | null>(null);
  const [wasInterrupted, setWasInterrupted] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const activeConversationId = externalConversationId ?? internalConversationId;

  // Load conversation from DB
  const { messages: dbMessages } = useConversation(activeConversationId);
  const { createConversation, addMessage, getNextSequence, deleteMessagesFromSequence } =
    useConversationMutations();

  // Sync DB messages to local state when conversation loads
  useEffect(() => {
    if (dbMessages && dbMessages.length > 0) {
      setMessages(toUIMessages(dbMessages));
    }
  }, [dbMessages]);

  // Get provider from model description
  const getProvider = useCallback((): Provider => {
    const desc = selectedModel?.description?.toLowerCase() ?? '';
    if (desc.includes('bedrock-mantle')) return 'bedrock-mantle';
    if (desc.includes('bedrock')) return 'bedrock';
    if (desc.includes('groq')) return 'groq';
    if (desc.includes('cerebras')) return 'cerebras';
    if (desc.includes('anthropic')) return 'anthropic';
    if (desc.includes('lmstudio')) return 'lmstudio';
    if (desc.includes('ollama')) return 'ollama';
    return 'bedrock';
  }, [selectedModel]);

  // Stop generation
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setWasInterrupted(true);
      setStatus('idle');
    }
  }, []);

  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    setMetadata(null);
    setCumulativeUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    setError(null);
    setWasInterrupted(false);
    setInternalConversationId(null);
    onConversationChange?.(null);
  }, [onConversationChange]);

  // Reset usage (for model changes)
  const resetUsage = useCallback(() => {
    setCumulativeUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    setMetadata(null);
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (content: string, files?: Array<{ name: string; format: string; bytes: string }>) => {
      if (!content.trim() || !selectedModel || status === 'streaming') return;

      // Reset interrupted state when starting a new message
      setWasInterrupted(false);

      const provider = getProvider();
      const modelId = selectedModel.value || '';
      const modelName = selectedModel.label || modelId;

      // Create conversation if needed
      let currentConversationId = activeConversationId;
      if (!currentConversationId) {
        const newConversation = await createConversation();
        currentConversationId = newConversation.id;
        setInternalConversationId(currentConversationId);
        onConversationChange?.(currentConversationId);
      }

      // Create user message
      const userMessage = createUIMessage('user', content);
      if (files && files.length > 0) {
        for (const file of files) {
          userMessage.parts.push({
            type: 'file',
            filename: file.name,
            mediaType: getMediaTypeFromFormat(file.format),
            data: file.bytes,
          } as MessagePart);
        }
      }

      setMessages((prev) => [...prev, userMessage]);
      setStatus('streaming');
      setError(null);

      // Persist user message to DB
      const userSequence = await getNextSequence(currentConversationId);
      await addMessage({
        conversationId: currentConversationId,
        role: 'user',
        content,
        sequence: userSequence,
        createdAt: new Date(),
        provider,
        modelId,
        modelName,
        parameters: { temperature, topP, maxTokens },
      });

      // Create abort controller
      abortControllerRef.current = new AbortController();

      // Create streaming assistant message
      const assistantMessage: UIMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        parts: [],
        createdAt: new Date(),
      };

      try {
        // Build request - filter out messages with empty content
        const chatMessages = [...messages, userMessage]
          .filter((m) => {
            const textContent = getTextContent(m);
            return textContent.trim().length > 0;
          })
          .map((m) => ({
            role: m.role,
            content: getTextContent(m),
            files: m.parts
              .filter((p): p is MessagePart & { type: 'file' } => p.type === 'file')
              .map((p) => ({
                name: (p as { filename?: string }).filename || 'file',
                format: getFormatFromMediaType((p as { mediaType?: string }).mediaType || ''),
                bytes: (p as { data?: string }).data || '',
              })),
          }));

        // Determine which sampling parameter to send for Claude 4.5
        const modelIdLower = modelId.toLowerCase();
        const isClaude45 =
          modelIdLower.includes('sonnet-4-5') ||
          modelIdLower.includes('haiku-4-5') ||
          modelIdLower.includes('opus-4-5');

        const requestBody = {
          model: modelId,
          messages: chatMessages,
          max_tokens: maxTokens,
          enableWebSearch,
          ...(isClaude45
            ? samplingParameter === 'temperature'
              ? { temperature }
              : { top_p: topP }
            : { temperature, top_p: topP }),
        };

        // Route to appropriate endpoint based on provider
        let endpoint: string;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Add Tavily API key if web search is enabled
        const prefs = loadPreferences();
        if (enableWebSearch && prefs.tavilyApiKey) {
          headers['X-Tavily-Api-Key'] = prefs.tavilyApiKey;
        }

        // Build provider-specific request
        if (provider === 'bedrock-mantle') {
          endpoint = '/api/mantle/chat';
          const apiKey = mantleService.getApiKey();
          if (!apiKey) {
            throw new Error(
              'Bedrock Mantle API key is required. Please configure it in preferences.'
            );
          }
          headers['X-Mantle-Api-Key'] = apiKey;
          headers['X-Mantle-Region'] = mantleService.getRegion();
        } else if (provider === 'groq' || provider === 'cerebras') {
          endpoint = '/api/aisdk/chat';
          const prefs = loadPreferences();
          const apiKey = provider === 'groq' ? prefs.groqApiKey : prefs.cerebrasApiKey;
          if (!apiKey) {
            throw new Error(
              `${provider === 'groq' ? 'Groq' : 'Cerebras'} API key is required. Please configure it in preferences.`
            );
          }
          headers['X-Api-Key'] = apiKey;
          // Add provider to request body for AI SDK proxy
          (requestBody as Record<string, unknown>).provider = provider;
        } else if (provider === 'anthropic') {
          endpoint = '/api/anthropic/chat';
          const prefs = loadPreferences();
          if (!prefs.anthropicApiKey) {
            throw new Error('Anthropic API key is required. Please configure it in preferences.');
          }
          headers['X-Api-Key'] = prefs.anthropicApiKey;
        } else if (provider === 'lmstudio') {
          endpoint = '/api/lmstudio-aisdk/chat';
          // No API key needed for local LM Studio
        } else if (provider === 'ollama') {
          endpoint = '/api/ollama-aisdk/chat';
          // No API key needed for local Ollama
        } else {
          // Default to Bedrock
          endpoint = '/api/bedrock-aisdk/chat';
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        // Process stream - different formats for Bedrock vs Mantle
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is not readable');

        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = '';
        let usageData: UsageMetadata | null = null;
        const startTime = Date.now();

        // Track pending tool calls
        const toolCalls: Map<
          string,
          {
            toolName: string;
            args: Record<string, unknown>;
            status: 'pending' | 'complete' | 'error';
            result?: unknown;
          }
        > = new Map();

        // Helper to build parts array with reasoning, tool calls, and content
        const buildParts = (): MessagePart[] => {
          const parts: MessagePart[] = [];
          if (fullReasoning) {
            parts.push({ type: 'reasoning', reasoning: fullReasoning } as MessagePart);
          }
          // Add tool calls
          for (const [id, tc] of toolCalls) {
            parts.push({
              type: 'tool-call',
              toolCallId: id,
              toolName: tc.toolName,
              args: tc.args,
              result: tc.result,
              status: tc.status,
            } as MessagePart);
          }
          if (fullContent) {
            parts.push({ type: 'text', text: fullContent });
          }
          return parts;
        };

        // Both Bedrock and Mantle now use SSE format: data: {"content": "..."} or data: {"metadata": {...}}
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);

                // Handle reasoning content (e.g., MiniMax models)
                if (parsed.reasoning) {
                  fullReasoning += parsed.reasoning;
                  assistantMessage.parts = buildParts();
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...assistantMessage };
                    } else {
                      newMessages.push({ ...assistantMessage });
                    }
                    return newMessages;
                  });
                }

                // Handle tool call
                if (parsed.toolCall) {
                  const { id, name, args } = parsed.toolCall;
                  toolCalls.set(id, { toolName: name, args, status: 'pending' });
                  assistantMessage.parts = buildParts();
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...assistantMessage };
                    } else {
                      newMessages.push({ ...assistantMessage });
                    }
                    return newMessages;
                  });
                }

                // Handle tool result
                if (parsed.toolResult) {
                  const { id, result } = parsed.toolResult;
                  const existing = toolCalls.get(id);
                  if (existing) {
                    toolCalls.set(id, { ...existing, result, status: 'complete' });
                    assistantMessage.parts = buildParts();
                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const lastIdx = newMessages.length - 1;
                      if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                        newMessages[lastIdx] = { ...assistantMessage };
                      } else {
                        newMessages.push({ ...assistantMessage });
                      }
                      return newMessages;
                    });
                  }
                }

                // Handle regular content
                if (parsed.content) {
                  fullContent += parsed.content;
                  assistantMessage.parts = buildParts();
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...assistantMessage };
                    } else {
                      newMessages.push({ ...assistantMessage });
                    }
                    return newMessages;
                  });
                } else if (parsed.metadata?.usage) {
                  usageData = {
                    inputTokens: parsed.metadata.usage.inputTokens,
                    outputTokens: parsed.metadata.usage.outputTokens,
                    totalTokens: parsed.metadata.usage.totalTokens,
                    latencyMs: parsed.metadata.latencyMs || Date.now() - startTime,
                  };
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }

        // Set usage metadata if available
        if (usageData) {
          setMetadata(usageData);
          // Update cumulative usage
          setCumulativeUsage((prev) => ({
            inputTokens: prev.inputTokens + (usageData.inputTokens || 0),
            outputTokens: prev.outputTokens + (usageData.outputTokens || 0),
            totalTokens: prev.totalTokens + (usageData.totalTokens || 0),
          }));
        }

        // Persist assistant message to DB - include reasoning in <think> tags
        const assistantSequence = await getNextSequence(currentConversationId);
        let dbContent = fullContent;
        if (fullReasoning) {
          dbContent = `<think>${fullReasoning}</think>\n${fullContent}`;
        }
        await addMessage({
          conversationId: currentConversationId,
          role: 'assistant',
          content: dbContent,
          sequence: assistantSequence,
          createdAt: new Date(),
          provider,
          modelId,
          modelName,
          parameters: { temperature, topP, maxTokens },
          usage: usageData || undefined,
        });

        setStatus('idle');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('Generation stopped by user');
          setStatus('idle');
          return;
        }

        console.error('Bedrock chat error:', err);
        setError((err as Error).message || 'Failed to send message');
        setStatus('error');
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      selectedModel,
      status,
      activeConversationId,
      messages,
      temperature,
      topP,
      maxTokens,
      samplingParameter,
      enableWebSearch,
      getProvider,
      createConversation,
      addMessage,
      getNextSequence,
      onConversationChange,
    ]
  );

  // Regenerate response
  const regenerate = useCallback(
    async (assistantMessageIndex: number) => {
      if (status === 'streaming' || !selectedModel) return;

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
      const userContent = getTextContent(userMessage);

      // Remove messages from assistant onwards
      const newMessages = messages.slice(0, userMessageIndex + 1);

      // Delete from DB
      if (activeConversationId) {
        const fromSequence = assistantMessageIndex + 1;
        await deleteMessagesFromSequence(activeConversationId, fromSequence);
      }

      setMessages(newMessages);

      // Re-send the user message (without files for regeneration)
      await sendMessage(userContent);
    },
    [status, selectedModel, messages, activeConversationId, deleteMessagesFromSequence, sendMessage]
  );

  return {
    messages,
    status,
    error,
    metadata,
    cumulativeUsage,
    wasInterrupted,
    sendMessage,
    regenerate,
    stopGeneration,
    clearMessages,
    resetUsage,
  };
}

// Helper functions
function getMediaTypeFromFormat(format: string): string {
  const formatMap: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    html: 'text/html',
    md: 'text/markdown',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return formatMap[format.toLowerCase()] || 'application/octet-stream';
}

function getFormatFromMediaType(mediaType: string): string {
  const typeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return typeMap[mediaType] || 'bin';
}
