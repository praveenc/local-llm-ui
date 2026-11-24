/**
 * useBedrockChat Hook
 *
 * Custom hook for managing chat with AI SDK streaming.
 * Handles message state, streaming, and conversation persistence.
 * Supports all providers: each one has a server proxy that streams the same SSE events.
 */
import { toast } from 'sonner';

import { useCallback, useRef, useState } from 'react';

import type { MessageFeedback, Provider } from '../db/types';
import { mantleService } from '../services';
import type { MessagePart, ToolCallPart, UIMessage } from '../types/ai-messages';
import { createUIMessage, getTextContent, toUIMessages } from '../types/ai-messages';
import { extractErrorMessage } from '../utils/errorMessage';
import { normalizeMediaType } from '../utils/fileUtils';
import { getMediaTypeFromFormat, lookupFormat } from '../utils/mediaTypes';
import { loadPreferences } from '../utils/preferences';
import { supportsThinkingEffort } from '../utils/thinkingEffort';
import type { ThinkingEffort } from '../utils/thinkingEffort';
import { toStoredToolCall } from '../utils/toolResults';
import { type MessageUsage, parseMessageUsage } from '../utils/usage';
import { buildWebSearchHeaders } from '../utils/webSearch';
import { useConversation, useConversationMutations } from './index';

export type ChatStatus = 'idle' | 'streaming' | 'submitted' | 'error';

/** The model that the chat sends to */
export interface ChatModel {
  id: string;
  name: string;
  provider: Provider;
  /** The provider reports that the model can think (Ollama) */
  supportsThinking?: boolean;
  /** False when the provider reports that the model cannot use tools (Ollama) */
  supportsTools?: boolean;
}

interface UseBedrockChatOptions {
  conversationId: string | null;
  selectedModel: ChatModel | null;
  maxTokens: number;
  /** Most model calls in one reply when tools are on */
  maxToolSteps: number;
  thinkingEffort: ThinkingEffort;
  enableWebSearch?: boolean;
  onConversationChange?: (id: string | null) => void;
}

interface UseBedrockChatReturn {
  messages: UIMessage[];
  status: ChatStatus;
  error: string | null;
  wasInterrupted: boolean;
  sendMessage: (
    content: string,
    files?: Array<{ name: string; format: string; bytes: string }>
  ) => Promise<void>;
  regenerate: (messageIndex: number) => Promise<void>;
  /** Resend the last user message after a failed reply */
  retryLast: () => Promise<void>;
  forkAndSend: (messageIndex: number, content: string) => Promise<void>;
  /** Thumbs up or down on a message; the same rating again clears it */
  rateMessage: (messageId: string, feedback: MessageFeedback) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
}

export function useBedrockChat({
  conversationId: externalConversationId,
  selectedModel,
  maxTokens,
  maxToolSteps,
  thinkingEffort,
  enableWebSearch = false,
  onConversationChange,
}: UseBedrockChatOptions): UseBedrockChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [internalConversationId, setInternalConversationId] = useState<string | null>(null);
  const [wasInterrupted, setWasInterrupted] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const activeConversationId = externalConversationId ?? internalConversationId;

  // Load conversation from DB
  const { messages: dbMessages } = useConversation(activeConversationId);
  const {
    createConversation,
    addMessage,
    getNextSequence,
    deleteMessagesFromSequence,
    forkConversation,
    setMessageFeedback,
  } = useConversationMutations();

  // Sync DB messages to local state when conversation loads (adjusting state during render)
  const [syncedDbMessages, setSyncedDbMessages] = useState(dbMessages);
  if (dbMessages !== syncedDbMessages) {
    setSyncedDbMessages(dbMessages);
    if (dbMessages && dbMessages.length > 0) {
      setMessages(toUIMessages(dbMessages));
    }
  }

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
    setError(null);
    setWasInterrupted(false);
    setInternalConversationId(null);
    onConversationChange?.(null);
  }, [onConversationChange]);

  // Send message
  const sendMessage = useCallback(
    async (
      content: string,
      files?: Array<{ name: string; format: string; bytes: string }>,
      // Used by forkAndSend: send into a conversation that state does not show yet
      target?: { conversationId: string; history: UIMessage[] }
    ) => {
      if (!content.trim() || !selectedModel || status === 'streaming') return;

      // Reset interrupted state when starting a new message
      setWasInterrupted(false);

      const { provider, id: modelId, name: modelName } = selectedModel;
      // A model that cannot use tools gets no web search and no MCP tools (Ollama rejects them)
      const useTools = selectedModel.supportsTools !== false;

      // Create conversation if needed
      let currentConversationId = target?.conversationId ?? activeConversationId;
      if (!currentConversationId) {
        const newConversation = await createConversation();
        currentConversationId = newConversation.id;
        setInternalConversationId(currentConversationId);
        onConversationChange?.(currentConversationId);
      }

      // Send (and record) the thinking effort only when the user chose one the model accepts
      const effort =
        thinkingEffort !== 'default' &&
        supportsThinkingEffort(provider, modelId, selectedModel.supportsThinking)
          ? thinkingEffort
          : undefined;
      const parameters = { maxTokens, ...(effort && { thinkingEffort: effort }) };

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
        parameters,
      });

      // Create abort controller
      abortControllerRef.current = new AbortController();

      // Create streaming assistant message
      const assistantMessage: UIMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        parts: [],
        createdAt: new Date(),
        model: { provider, id: modelId, name: modelName },
      };

      // Set by the stream loop so the abort handler can flush text received so far
      let flushOnAbort: (() => void) | null = null;

      try {
        // Build request - filter out messages with empty content
        const chatMessages = [...(target?.history ?? messages), userMessage]
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

        const requestBody = {
          model: modelId,
          messages: chatMessages,
          max_tokens: maxTokens,
          maxToolSteps,
          enableWebSearch: useTools && enableWebSearch,
          ...(effort && { thinkingEffort: effort }),
        };

        // Route to appropriate endpoint based on provider
        let endpoint: string;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        const prefs = loadPreferences();

        // Add web search API keys and the provider order if web search is enabled
        if (useTools && enableWebSearch) {
          Object.assign(headers, buildWebSearchHeaders(prefs));
        }

        // Add enabled MCP server configs
        const enabledMCPServers =
          useTools && prefs.mcpServers
            ? Object.values(prefs.mcpServers).filter((s) => s.enabled)
            : [];
        if (enabledMCPServers.length > 0) {
          (requestBody as Record<string, unknown>).mcpServers = enabledMCPServers;
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
          if (!prefs.anthropicApiKey) {
            throw new Error('Anthropic API key is required. Please configure it in preferences.');
          }
          headers['X-Api-Key'] = prefs.anthropicApiKey;
        } else if (provider === 'openrouter') {
          endpoint = '/api/openrouter/chat';
          if (!prefs.openrouterApiKey) {
            throw new Error('OpenRouter API key is required. Please configure it in preferences.');
          }
          headers['X-Api-Key'] = prefs.openrouterApiKey;
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

        // The model thinks before its first chunk arrives, so thinking time counts from here
        const requestStart = Date.now();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            extractErrorMessage(responseText) || `HTTP error! status: ${response.status}`
          );
        }

        // Process stream - different formats for Bedrock vs Mantle
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is not readable');

        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = '';
        let usageData: MessageUsage | undefined;
        const startTime = Date.now();
        // Thinking time: each gap that ends with a reasoning chunk counts as thinking, also the
        // wait for the first chunk when that chunk is reasoning
        let reasoningMs = 0;
        let lastEventAt = requestStart;

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

        // Push the assistant message's current parts into state (replaces the streaming one)
        const flushAssistantMessage = () => {
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
        };

        // Coalesce per-chunk updates to at most one state update per animation frame.
        // Streamdown re-parses the whole reply on every render, so one render per chunk
        // (hundreds per reply) is the hot path. Callers still call this on every event;
        // the final flush on done/error/abort guarantees the last chunk is shown.
        let rafId: number | null = null;
        const showAssistantMessage = () => {
          if (rafId !== null) return;
          rafId = requestAnimationFrame(() => {
            rafId = null;
            flushAssistantMessage();
          });
        };
        const flushNow = () => {
          // Only a pending frame needs flushing; this also keeps an error that arrives before
          // any content from adding an empty assistant message
          if (rafId === null) return;
          cancelAnimationFrame(rafId);
          rafId = null;
          flushAssistantMessage();
        };
        flushOnAbort = flushNow;

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

              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(data) as Record<string, unknown>;
              } catch {
                // Skip malformed JSON lines only
                continue;
              }

              const now = Date.now();
              if (parsed.reasoning) reasoningMs += now - lastEventAt;
              lastEventAt = now;

              // Handle explicit error payloads in stream
              if (parsed.error) {
                const streamError =
                  extractErrorMessage(parsed.error) || extractErrorMessage(parsed);
                throw new Error(streamError || 'Stream error');
              }

              // Handle reasoning content (e.g., MiniMax models)
              if (parsed.reasoning) {
                fullReasoning += parsed.reasoning as string;
                showAssistantMessage();
              }

              // Handle tool call
              if (parsed.toolCall) {
                const toolCall = parsed.toolCall as {
                  id: string;
                  name: string;
                  args: Record<string, unknown>;
                };
                const { id, name, args } = toolCall;
                toolCalls.set(id, { toolName: name, args, status: 'pending' });
                showAssistantMessage();
              }

              // Handle tool result
              if (parsed.toolResult) {
                const toolResult = parsed.toolResult as {
                  id: string;
                  result?: unknown;
                  /** Set when the tool failed: see server/tool-loop.ts toolErrorEvent */
                  error?: string;
                };
                const { id, result, error } = toolResult;
                const existing = toolCalls.get(id);
                if (existing) {
                  toolCalls.set(
                    id,
                    error
                      ? { ...existing, result: error, status: 'error' }
                      : { ...existing, result, status: 'complete' }
                  );
                  showAssistantMessage();
                }
              }

              // Handle regular content
              if (parsed.content) {
                fullContent += parsed.content as string;
                showAssistantMessage();
              } else if (parsed.metadata) {
                const metadata = parsed.metadata as { usage?: unknown; latencyMs?: unknown };
                const usage =
                  metadata.usage && typeof metadata.usage === 'object'
                    ? parseMessageUsage({ ...metadata.usage, latencyMs: metadata.latencyMs })
                    : undefined;
                // Mantle sends no latency: measure it here
                if (usage) usageData = { latencyMs: Date.now() - startTime, ...usage };
              }
            }
          }
        }

        // Flush the last pending frame so the final chunk always shows
        flushNow();

        // A tool without a result when the reply ends failed; keep the thinking time
        const storedToolCalls = buildParts()
          .filter((p): p is ToolCallPart => p.type === 'tool-call')
          .map(toStoredToolCall);
        for (const tc of storedToolCalls) {
          const existing = toolCalls.get(tc.toolCallId);
          if (existing?.status === 'pending') {
            toolCalls.set(tc.toolCallId, { ...existing, status: 'error', result: tc.result });
          }
        }
        if (fullReasoning && reasoningMs > 0) assistantMessage.reasoningMs = reasoningMs;
        flushAssistantMessage();

        // Show the reply's usage; the context meter and the cost are read from the messages
        if (usageData) {
          const usage = usageData;
          assistantMessage.usage = usage;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMessage.id ? { ...m, usage } : m))
          );
        }

        // Persist assistant message to DB - include reasoning in <think> tags
        const assistantSequence = await getNextSequence(currentConversationId);
        let dbContent = fullContent;
        if (fullReasoning) {
          dbContent = `<think>${fullReasoning}</think>\n${fullContent}`;
        }
        const saved = await addMessage({
          conversationId: currentConversationId,
          role: 'assistant',
          content: dbContent,
          sequence: assistantSequence,
          createdAt: new Date(),
          provider,
          modelId,
          modelName,
          parameters,
          usage: usageData,
          ...(storedToolCalls.length > 0 && { toolCalls: storedToolCalls }),
          ...(assistantMessage.reasoningMs && { reasoningMs: assistantMessage.reasoningMs }),
        });
        // Give the shown message the stored id, so feedback on it finds the DB row
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessage.id ? { ...m, id: saved.id } : m))
        );

        setStatus('idle');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('Generation stopped by user');
          // Keep the text received before the abort
          flushOnAbort?.();
          setStatus('idle');
          return;
        }

        console.error('Bedrock chat error:', err);
        // Keep whatever streamed before the error
        flushOnAbort?.();
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
      maxTokens,
      maxToolSteps,
      thinkingEffort,
      enableWebSearch,
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

  // Resend the last user message after a failed reply. Files are not resent (as in regenerate).
  const retryLast = useCallback(async () => {
    if (status === 'streaming' || !selectedModel || !activeConversationId) return;
    let lastUserIndex = -1;
    messages.forEach((m, i) => {
      if (m.role === 'user') lastUserIndex = i;
    });
    if (lastUserIndex === -1) return;
    const content = getTextContent(messages[lastUserIndex]);
    const history = messages.slice(0, lastUserIndex);
    // Drop the failed turn (DB sequences are 1-based) so it is not sent twice
    await deleteMessagesFromSequence(activeConversationId, lastUserIndex + 1);
    setMessages(history);
    await sendMessage(content, undefined, { conversationId: activeConversationId, history });
  }, [
    status,
    selectedModel,
    activeConversationId,
    messages,
    deleteMessagesFromSequence,
    sendMessage,
  ]);

  // Copy the conversation up to and including messageIndex into a new
  // conversation, switch to it, and send content there
  const forkAndSend = useCallback(
    async (messageIndex: number, content: string) => {
      if (!activeConversationId || !selectedModel || status === 'streaming') return;

      const history = messages.slice(0, messageIndex + 1);
      try {
        const forked = await forkConversation(activeConversationId, history.length);
        setInternalConversationId(forked.id);
        onConversationChange?.(forked.id);
        setMessages(history);
        setWasInterrupted(false);
        await sendMessage(content, undefined, { conversationId: forked.id, history });
      } catch (err) {
        console.error('Fork failed:', err);
        setError((err as Error).message || 'Failed to fork conversation');
        setStatus('error');
      }
    },
    [
      activeConversationId,
      selectedModel,
      status,
      messages,
      forkConversation,
      onConversationChange,
      sendMessage,
    ]
  );

  // Rate a message. The same rating again clears it. The UI updates first; the DB follows.
  const rateMessage = useCallback(
    async (messageId: string, feedback: MessageFeedback) => {
      const current = messages.find((m) => m.id === messageId)?.feedback;
      const next = current === feedback ? null : feedback;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: next ?? undefined } : m))
      );
      try {
        await setMessageFeedback(messageId, next);
        toast.success(next ? 'Feedback saved' : 'Feedback removed');
      } catch (err) {
        console.error('Failed to save feedback:', err);
        toast.error('Could not save feedback');
      }
    },
    [messages, setMessageFeedback]
  );

  return {
    messages,
    status,
    error,
    wasInterrupted,
    sendMessage,
    regenerate,
    retryLast,
    forkAndSend,
    rateMessage,
    stopGeneration,
    clearMessages,
  };
}

/** The format that the chat sends with a file. Text-like types map to txt; unknown types to bin. */
function getFormatFromMediaType(mediaType: string): string {
  // Normalize text-like MIME types (e.g. application/x-sh -> text/plain)
  const normalized = normalizeMediaType(mediaType);
  if (!normalized) return 'bin'; // truly unsupported binary
  return lookupFormat(normalized) ?? 'txt';
}
