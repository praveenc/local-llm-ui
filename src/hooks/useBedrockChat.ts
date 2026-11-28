/**
 * useBedrockChat Hook
 *
 * Custom hook for managing chat with AI SDK streaming.
 * Handles message state, streaming, and conversation persistence.
 * Supports all providers: each one has a server proxy that streams the same SSE events.
 */
import { toast } from 'sonner';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  KiroConversationSession,
  MessageFeedback,
  NewAttachment,
  Provider,
} from '../db/types';
import { conversationService } from '../services/conversationService';
import { kiroService } from '../services/kiro';
import { prepareKiroSend } from '../services/kiroSyncs';
import { notifyReply } from '../services/replyNotices';
import type { KiroModelMeta } from '../services/types';
import type { FilePart, MessagePart, ToolCallPart, UIMessage } from '../types/ai-messages';
import {
  base64Size,
  base64ToBytes,
  createUIMessage,
  getTextContent,
  toUIMessages,
} from '../types/ai-messages';
import { acceptsKind, classifyFile, fileAccepts } from '../utils/attachments';
import type { FileAccepts } from '../utils/attachments';
import { extractErrorMessage } from '../utils/errorMessage';
import {
  type KiroChatRequest,
  type KiroHistoryMessage,
  kiroSessionIsStale,
} from '../utils/kiroChat';
import {
  endApproval,
  openApproval,
  parseKiroPermissionQuestion,
  parseKiroPermissionResult,
} from '../utils/kiroPermissions';
import { isKiroChatInSync, parseKiroSessionStamp } from '../utils/kiroSessions';
import { checkableServers } from '../utils/mcpServers';
import { getMediaTypeFromFormat } from '../utils/mediaTypes';
import { loadPreferences } from '../utils/preferences';
import { isRunningStatus, replyStore } from '../utils/replyStore';
import {
  parseSessionOptionsSnapshot,
  processWideOptionIds,
  sessionOptionsToSend,
  snapshotValues,
} from '../utils/sessionOptions';
import { supportsThinkingEffort, thinkingEffortOptions, withoutMax } from '../utils/thinkingEffort';
import type { ThinkingEffort } from '../utils/thinkingEffort';
import { toStoredToolCall } from '../utils/toolResults';
import { type MessageUsage, parseMessageUsage } from '../utils/usage';
import { buildWebSearchHeaders } from '../utils/webSearch';
import { useConversation, useConversationMutations } from './index';
import {
  type StreamToolCall,
  questionTarget,
  questionToolCall,
  withQuestionEnded,
  withQuestionsEnded,
} from './kiroApprovalState';
import { useReply } from './useReplies';
import {
  NEW_CHAT_KEY,
  clearPendingSessionOptions,
  movePendingSessionOptions,
  pendingSessionOptions,
} from './useSessionOptions';

export type ChatStatus = 'idle' | 'streaming' | 'submitted' | 'error';

/**
 * A file to send with a message: base64 `bytes`. A file whose bytes were not kept (D-C) has no
 * `bytes`: regenerate and retry send it as a text line and keep its name.
 */
export interface ChatFile {
  name: string;
  format: string;
  bytes?: string;
  size?: number;
}

/** The most bytes of JSON that the server takes in one request (`MAX_BODY_SIZE`, `server/security.ts`) */
export const REQUEST_LIMIT = 10 * 1024 * 1024;

/**
 * Room for the messages of one request: their text and their files. The 1 MB margin is for the
 * rest of the body (model, settings, the MCP server list) and the JSON escapes of odd text.
 * Earlier files past it go as a text line (D-E).
 */
export const REQUEST_BUDGET = REQUEST_LIMIT - 1024 * 1024;

/** The model that the chat sends to */
export interface ChatModel {
  id: string;
  name: string;
  provider: Provider;
  /** The provider reports that the model can think (Ollama) */
  supportsThinking?: boolean;
  /** False when the provider reports that the model cannot use tools (Ollama) */
  supportsTools?: boolean;
  /** Kiro: the model's effort levels, for the Thinking choices */
  kiro?: KiroModelMeta;
  /** The file types that the model reads; unset: the provider's table (D-A c) */
  accepts?: FileAccepts;
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
  /**
   * Progress of the streaming reply before its first output, for example "Starting Kiro…".
   * Not stored with the reply.
   */
  streamStatus: string | null;
  sendMessage: (content: string, files?: ChatFile[]) => Promise<void>;
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
  // The open chat as the database has it. A reply of the open chat shows from the reply store.
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [internalConversationId, setInternalConversationId] = useState<string | null>(null);

  const activeConversationId = externalConversationId ?? internalConversationId;

  // The reply of the open chat: running, or ended and not yet dismissed. A reply of another chat
  // keeps running in the store and never shows here.
  const reply = useReply(activeConversationId);
  const shownMessages = reply?.messages ?? messages;
  const status: ChatStatus = reply?.status ?? 'idle';

  // The toasts need the chat on screen. Leaving a chat drops its ended reply: the chat then
  // reads the database when it opens again.
  useEffect(() => {
    replyStore.setOnScreen(activeConversationId);
    return () => {
      if (activeConversationId) replyStore.dismiss(activeConversationId);
    };
  }, [activeConversationId]);

  // Load conversation from DB
  const { messages: dbMessages, attachments: dbAttachments } =
    useConversation(activeConversationId);
  const {
    createConversation,
    addMessage,
    getNextSequence,
    deleteMessagesFromSequence,
    forkConversation,
    setMessageFeedback,
    getConversation,
    getMessages,
    setKiroSession,
    setTitleFromKiro,
  } = useConversationMutations();

  // Sync DB messages to local state when conversation loads (adjusting state during render).
  // Another chat clears the list until its messages load; an empty chat shows no messages. A
  // reply in the store still shows first (`shownMessages`), and the store entry stays as it is.
  // The stored file bytes come with the messages and change on their own (D-C).
  const [syncedDbMessages, setSyncedDbMessages] = useState(dbMessages);
  const [syncedDbAttachments, setSyncedDbAttachments] = useState(dbAttachments);
  const [syncedConversationId, setSyncedConversationId] = useState(activeConversationId);
  if (activeConversationId !== syncedConversationId) {
    setSyncedConversationId(activeConversationId);
    setSyncedDbMessages(dbMessages);
    setSyncedDbAttachments(dbAttachments);
    setMessages(dbMessages ? toUIMessages(dbMessages, dbAttachments) : []);
  } else if (dbMessages !== syncedDbMessages || dbAttachments !== syncedDbAttachments) {
    setSyncedDbMessages(dbMessages);
    setSyncedDbAttachments(dbAttachments);
    if (dbMessages) setMessages(toUIMessages(dbMessages, dbAttachments));
  }

  // Stop the reply of the open chat only. A new chat or a fork that this hook put on screen goes
  // first: the view does not render it yet. Refs, so that a closure from an earlier render stops
  // the same chat. Not the store's global `onScreen`, which another view can change.
  const latestConversationId = useRef(activeConversationId);
  const startedConversationId = useRef<string | null>(null);
  useEffect(() => {
    latestConversationId.current = activeConversationId;
    // The view shows this chat now (or the user opened another one)
    startedConversationId.current = null;
  }, [activeConversationId]);
  const stopGeneration = useCallback(() => {
    const id = startedConversationId.current ?? latestConversationId.current;
    if (id) void replyStore.stop(id);
  }, []);

  // New chat: the reply of the chat that was open keeps running in its own chat
  const clearMessages = useCallback(() => {
    setMessages([]);
    setInternalConversationId(null);
    onConversationChange?.(null);
  }, [onConversationChange]);

  // Send message
  const sendMessage = useCallback(
    async (
      content: string,
      files?: ChatFile[],
      // Used by forkAndSend: send into a conversation that state does not show yet
      target?: { conversationId: string; history: UIMessage[] }
    ) => {
      if (!selectedModel || isRunningStatus(status)) return;

      const { provider, id: modelId, name: modelName } = selectedModel;
      const isKiro = provider === 'kiro';
      // A message with only files has no text (no made-up text is stored); Kiro takes no files
      if (!content.trim() && (isKiro || !files?.length)) return;
      // A model that cannot use tools gets no web search and no MCP tools (Ollama rejects them)
      const useTools = selectedModel.supportsTools !== false;

      // Create conversation if needed
      let currentConversationId = target?.conversationId ?? activeConversationId;
      if (!currentConversationId) {
        const newConversation = await createConversation();
        currentConversationId = newConversation.id;
        // Agent and option picks made before the chat existed go with its first message (K9)
        movePendingSessionOptions(NEW_CHAT_KEY, currentConversationId);
        setInternalConversationId(currentConversationId);
        onConversationChange?.(currentConversationId);
      }
      // One reply per chat
      if (replyStore.isRunning(currentConversationId)) return;
      // A new chat or a fork is on screen now, also before the view renders it
      if (target || !activeConversationId) {
        replyStore.setOnScreen(currentConversationId);
        startedConversationId.current = currentConversationId;
      }
      // The messages before this one
      const baseMessages = target?.history ?? shownMessages;

      // Kiro keeps its own history: what the session has seen, and the chat's earlier messages (D12)
      let kiroRequest: KiroChatRequest | undefined;
      // The chat's Kiro record before this message, for the turn count (K7)
      let storedKiro: KiroConversationSession | undefined;
      // Kiro's time of the session after the reply, stored when the chat counts its turns (K11)
      let kiroUpdatedAt: string | undefined;
      // The session of this reply, from its first event
      let kiroSession: KiroConversationSession | undefined;
      // Kiro started on the message: an event of the turn came after the session event (K11)
      let kiroStarted = false;
      // The server sends one sessionOptions event before the prompt; later ones are the turn's
      let kiroOptionEvents = 0;
      // Set by the stream loop so the abort handler can flush text received so far
      let flushOnAbort: (() => void) | null = null;

      // Create user message
      const userMessage = createUIMessage('user', content);
      // Kiro takes no files in this version
      const sentFiles = !isKiro && files ? files : [];
      for (const file of sentFiles) {
        const size = file.bytes ? base64Size(file.bytes) : (file.size ?? 0);
        userMessage.parts.push({
          type: 'file',
          filename: file.name,
          mediaType: getMediaTypeFromFormat(file.format),
          size,
          ...(file.bytes ? { data: file.bytes } : { kept: false }),
        });
      }

      // A stopped Kiro run of this chat may still write its Kiro record: wait for it before the
      // record is read below. Taken before `start`, so it does not wait for this run.
      const previousRun = isKiro ? replyStore.whenFinished(currentConversationId) : undefined;
      // The chat shows the new message at once; the reply writes only to its own chat's entry
      const run = replyStore.start(currentConversationId, [...baseMessages, userMessage]);

      // Send (and record) the thinking effort only when the user chose one the model offers.
      // Max is a Kiro level; other providers get XHigh for it.
      const wantedEffort = isKiro ? thinkingEffort : withoutMax(thinkingEffort);
      const offeredEfforts = thinkingEffortOptions(provider, modelId, selectedModel.kiro).map(
        (option) => option.value
      );
      const effort =
        wantedEffort !== 'default' &&
        supportsThinkingEffort(provider, modelId, selectedModel.supportsThinking) &&
        offeredEfforts.includes(wantedEffort)
          ? wantedEffort
          : undefined;
      // Kiro takes no max tokens
      const parameters = {
        ...(!isKiro && { maxTokens }),
        ...(effort && { thinkingEffort: effort }),
      };

      try {
        // Kiro: read what the session has seen, and the chat's earlier messages, from the database
        // now: the chat may be new, or a fork (D12).
        if (isKiro) {
          await previousRun;
          // Stopped during the wait: end as a stop, before anything reads Kiro or starts it
          if (run.signal.aborted) {
            run.end('stopped');
            run.finish();
            return;
          }
          // Add the turns that Kiro made in the terminal first (a running sync, or one exact check
          // of Kiro's time): the history and the turn count below then include them (K7, K11)
          let sync = false;
          await prepareKiroSend(
            currentConversationId,
            () => {
              sync = true;
              run.update({ streamStatus: 'Adding the new Kiro turns…' });
            },
            // A slow check (it can start Kiro CLI) says so in words
            () => run.update({ streamStatus: 'Checking the Kiro session…' })
          );
          const [stored, storedMessages] = await Promise.all([
            getConversation(currentConversationId),
            getMessages(currentConversationId),
          ]);
          // The sync added turns to the database: the chat shows them before the new message,
          // with the files of earlier messages
          if (sync) {
            // A failed read only shows those files as not kept
            const storedFiles = await conversationService
              .getAttachments(currentConversationId)
              .catch(() => undefined);
            run.setMessages(() => [...toUIMessages(storedMessages, storedFiles), userMessage]);
          }
          storedKiro = stored?.kiro;
          const history: KiroHistoryMessage[] = toUIMessages(storedMessages)
            .filter((m): m is UIMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
            .map((m) => ({ role: m.role, content: getTextContent(m) }))
            .filter((m) => m.content.trim().length > 0);
          const seenMessages = stored?.kiro?.seenMessages ?? 0;
          // The same session gets only the user's new picks; a new one also the stored values (K9)
          const sessionOptions = sessionOptionsToSend({
            stored: stored?.kiro?.options,
            pending: pendingSessionOptions(currentConversationId, stored),
            newSession: !stored?.kiro?.sessionId || kiroSessionIsStale({ history, seenMessages }),
            processWide: processWideOptionIds(
              kiroService.getSessionOptions(stored?.kiro?.sessionId)
            ),
          });
          kiroRequest = {
            ...(stored?.kiro?.sessionId && { sessionId: stored.kiro.sessionId }),
            seenMessages,
            history,
            prompt: content,
            model: modelId,
            ...(effort && { thinkingEffort: effort }),
            ...(sessionOptions && { sessionOptions }),
          };
        }
      } catch (err) {
        // The chat's Kiro record could not be read: the run ends before the request
        console.error('Bedrock chat error:', err);
        run.end('failed', (err as Error).message || 'Failed to send message');
        run.finish();
        void notifyReply(currentConversationId, 'failed');
        return;
      }

      // Every path below ends the run: done, failed, or stopped
      try {
        run.update({ status: 'streaming', streamStatus: null });

        // Persist user message to DB, with the bytes of its files (D-C)
        const userSequence = await getNextSequence(currentConversationId);
        const savedUser = await addMessage(
          {
            conversationId: currentConversationId,
            role: 'user',
            content,
            sequence: userSequence,
            createdAt: new Date(),
            provider,
            modelId,
            modelName,
            parameters,
          },
          sentFiles.length > 0 ? sentFiles.map(toNewAttachment) : undefined
        );

        // The history with the files that fit in the request (D-E); Kiro gets no files
        const outgoing = kiroRequest
          ? undefined
          : buildChatMessages(
              [...baseMessages, userMessage],
              selectedModel.accepts ?? fileAccepts(provider)
            );

        // Create streaming assistant message
        const assistantMessage: UIMessage = {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          parts: [],
          createdAt: new Date(),
          model: { provider, id: modelId, name: modelName },
          ...(outgoing?.filesNotResent && { filesNotResent: outgoing.filesNotResent }),
        };

        // Route to appropriate endpoint based on provider
        let endpoint: string;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        let requestBody: Record<string, unknown>;

        if (kiroRequest) {
          // Kiro: no files, web search, MCP tools, max tokens, or tool steps
          endpoint = '/api/kiro/chat';
          requestBody = { ...kiroRequest };
        } else {
          requestBody = {
            model: modelId,
            messages: outgoing?.chatMessages ?? [],
            max_tokens: maxTokens,
            maxToolSteps,
            enableWebSearch: useTools && enableWebSearch,
            ...(effort && { thinkingEffort: effort }),
          };

          const prefs = loadPreferences();

          // Add web search API keys and the provider order if web search is enabled
          if (useTools && enableWebSearch) {
            Object.assign(headers, buildWebSearchHeaders(prefs));
          }

          // Add the MCP servers that are enabled and complete (never one that is half typed)
          const enabledMCPServers = useTools ? checkableServers(prefs.mcpServers) : [];
          if (enabledMCPServers.length > 0) {
            requestBody.mcpServers = enabledMCPServers;
          }

          // Build provider-specific request
          if (provider === 'bedrock-mantle') {
            endpoint = '/api/mantle/chat';
            const apiKey = prefs.bedrockMantleApiKey;
            if (!apiKey) {
              throw new Error(
                'Bedrock Mantle API key is required. Please configure it in preferences.'
              );
            }
            headers['X-Mantle-Api-Key'] = apiKey;
            headers['X-Mantle-Region'] = prefs.bedrockMantleRegion || 'us-west-2';
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
            requestBody.provider = provider;
          } else if (provider === 'anthropic') {
            endpoint = '/api/anthropic/chat';
            if (!prefs.anthropicApiKey) {
              throw new Error('Anthropic API key is required. Please configure it in preferences.');
            }
            headers['X-Api-Key'] = prefs.anthropicApiKey;
          } else if (provider === 'openrouter') {
            endpoint = '/api/openrouter/chat';
            if (!prefs.openrouterApiKey) {
              throw new Error(
                'OpenRouter API key is required. Please configure it in preferences.'
              );
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
        }

        // The model thinks before its first chunk arrives, so thinking time counts from here
        const requestStart = Date.now();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: run.signal,
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
        const toolCalls = new Map<string, StreamToolCall>();
        // Kiro's questions on those tool calls
        // Kiro's open questions: requestId → the tool call that shows it
        const openQuestions = new Map<string, string>();

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
              ...(tc.approvals && { approvals: tc.approvals }),
            } as MessagePart);
          }
          if (fullContent) {
            parts.push({ type: 'text', text: fullContent });
          }
          return parts;
        };

        // Push the assistant message's current parts into state (replaces the streaming one)
        const flushAssistantMessage = (change?: (parts: MessagePart[]) => MessagePart[]) => {
          assistantMessage.parts = change ? change(buildParts()) : buildParts();
          run.setMessages((prev) => {
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
        // Stop or an error: no question stays open, also when no frame is pending
        flushOnAbort = () => {
          if (openQuestions.size === 0) return flushNow();
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = null;
          flushAssistantMessage(withQuestionsEnded);
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

              // Kiro: the session of this reply. A new session has seen none of the chat.
              if (kiroRequest && isKiroSessionEvent(parsed.session)) {
                // A new session has no turns. A known one keeps its turn count, and its time
                // of the last sync, so a later open adds only the turns made elsewhere (K7). A
                // known one counts its turns on only when the next event shows that the chat
                // holds every turn: else the reply stores no count and the next open counts
                // again, so no sync imports a turn twice or out of order (K11).
                const known =
                  !parsed.session.created && storedKiro?.sessionId === parsed.session.id;
                kiroSession = {
                  sessionId: parsed.session.id,
                  seenMessages: parsed.session.created ? 0 : kiroRequest.seenMessages,
                  ...(parsed.session.created && { turns: 0 }),
                  ...(known && storedKiro?.updatedAt && { updatedAt: storedKiro.updatedAt }),
                  // The next sessionOptions event gives the session's values
                  ...(storedKiro?.options && { options: storedKiro.options }),
                };
                // The database keeps the stored count until the reply ends: when Kiro refuses
                // the message (another program holds the session), the next open still adds
                // the terminal turns from it, in Kiro's order (K11)
                await setKiroSession(currentConversationId, {
                  ...kiroSession,
                  ...(known && storedKiro?.turns !== undefined && { turns: storedKiro.turns }),
                });
                // The server sends it right before Kiro gets the message: "Starting Kiro…" is over
                run.update({ streamStatus: null });
              }
              // Kiro: the session's agent and options, after the session event and on each change.
              // The service keeps the lists for the controls; the chat's record keeps the values.
              if (kiroRequest && kiroSession && parsed.sessionOptions !== undefined) {
                kiroOptionEvents += 1;
                await saveSessionOptionsEvent(
                  parsed.sessionOptions,
                  currentConversationId,
                  kiroSession.sessionId
                );
              }
              // Kiro: its time of the session before this message. The same time as the chat's
              // last sync: the chat holds every turn, so it counts on (K11). A new object, not the
              // record: the React Compiler lint counts a passed record as changed.
              if (
                kiroSession &&
                kiroSession.turns === undefined &&
                storedKiro?.sessionId === kiroSession.sessionId &&
                isKiroChatInSync(
                  { turns: storedKiro.turns, updatedAt: storedKiro.updatedAt },
                  parseKiroSessionStamp(parsed.sessionUpdatedBefore)
                )
              ) {
                kiroSession = { ...kiroSession, turns: storedKiro.turns };
              }
              // Kiro: an event of the turn shows that Kiro took the message (K11)
              if (kiroSession && !kiroStarted) {
                kiroStarted = isKiroTurnEvent(parsed) || kiroOptionEvents > 1;
              }
              // Kiro: its time of the session after this turn (K11)
              if (kiroRequest) {
                kiroUpdatedAt = parseKiroSessionStamp(parsed.sessionUpdatedAt) ?? kiroUpdatedAt;
              }
              // Kiro: its short title replaces the automatic one
              if (kiroRequest && typeof parsed.title === 'string' && parsed.title.trim()) {
                await setTitleFromKiro(currentConversationId, parsed.title).catch((err: unknown) =>
                  console.error('Failed to save the Kiro title:', err)
                );
              }
              // Progress before the first output; the first output clears it
              if (typeof parsed.status === 'string') {
                run.update({ streamStatus: parsed.status || null });
              } else if (
                parsed.content ||
                parsed.reasoning ||
                parsed.toolCall ||
                parsed.toolResult ||
                parsed.permission
              ) {
                run.update({ streamStatus: null });
              }

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
                // A question can come before its tool call: keep it
                const asked = toolCalls.get(id)?.approvals;
                toolCalls.set(id, {
                  toolName: name,
                  args,
                  status: 'pending',
                  ...(asked && { approvals: asked }),
                });
                showAssistantMessage();
              }

              // Kiro: a question about a tool call, and its end
              const question = kiroRequest
                ? parseKiroPermissionQuestion(parsed.permission)
                : undefined;
              if (question) {
                const id = questionTarget(question, [...toolCalls.keys()]);
                const entry = toolCalls.get(id) ?? questionToolCall(question);
                toolCalls.set(id, {
                  ...entry,
                  approvals: [...(entry.approvals ?? []), openApproval(question)],
                });
                openQuestions.set(question.requestId, id);
                showAssistantMessage();
                // The sidebar says "Waiting for your answer"; off screen, a toast says it too
                run.update({ waiting: true });
                void notifyReply(currentConversationId, 'waiting');
              }
              const answer = kiroRequest
                ? parseKiroPermissionResult(parsed.permissionResult)
                : undefined;
              const answered = answer ? openQuestions.get(answer.requestId) : undefined;
              const entry = answered ? toolCalls.get(answered) : undefined;
              if (answer && answered && entry) {
                openQuestions.delete(answer.requestId);
                toolCalls.set(answered, {
                  ...entry,
                  approvals: entry.approvals?.map((a) =>
                    a.requestId === answer.requestId && a.state === 'open'
                      ? endApproval(a, answer)
                      : a
                  ),
                });
                showAssistantMessage();
                run.update({ waiting: openQuestions.size > 0 });
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

        // A question that is still open was not answered
        for (const id of new Set(openQuestions.values())) {
          const entry = toolCalls.get(id);
          if (entry) toolCalls.set(id, withQuestionEnded(entry));
          showAssistantMessage();
        }
        openQuestions.clear();
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
          run.setMessages((prev) =>
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
          ...(assistantMessage.filesNotResent && {
            filesNotResent: assistantMessage.filesNotResent,
          }),
        });
        // Give the shown message the stored id, so feedback on it finds the DB row. The user
        // message's files that the database could not keep say so now, as after a reload.
        run.setMessages((prev) =>
          withFilesNotKept(
            prev.map((m) => (m.id === assistantMessage.id ? { ...m, id: saved.id } : m)),
            userMessage.id,
            savedUser?.attachments?.map((a) => a.kept) ?? []
          )
        );

        // Kiro has seen the chat, the new message, and its reply. The next history leaves out
        // a reply with no text (tools or thinking only), so count it only when it has text.
        if (kiroRequest && kiroSession) {
          await setKiroSession(currentConversationId, {
            ...kiroSession,
            seenMessages: kiroRequest.history.length + 1 + (fullContent.trim() ? 1 : 0),
            ...nextTurns(kiroSession),
            // The next open then runs no replay for this reply (D25)
            ...(kiroSession.turns !== undefined && kiroUpdatedAt && { updatedAt: kiroUpdatedAt }),
          });
        }

        // A stopped run has already ended: no toast for it
        if (run.isActive()) {
          run.end('done');
          void notifyReply(currentConversationId, 'done');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('Generation stopped by user');
          // Keep the text received before the abort (the store keeps it until finish)
          flushOnAbort?.();
          run.end('stopped');
          // The server sends the session event right before Kiro gets the message, so with it
          // Kiro got the new message (the app does not store the partial reply). Without it,
          // Kiro never got the message and the chat's Kiro record stays as it was.
          if (kiroRequest && kiroSession) {
            await setKiroSession(currentConversationId, {
              ...kiroSession,
              seenMessages: kiroRequest.history.length + 1,
              ...nextTurns(kiroSession),
            }).catch((saveErr: unknown) =>
              console.error('Failed to save the Kiro session:', saveErr)
            );
          }
          return;
        }

        console.error('Bedrock chat error:', err);
        // Kiro took the message and then failed (it stopped, or the connection broke): Kiro may
        // have the turn, so the chat no longer knows its count, and the next open counts again
        // (K11). When Kiro refused the message, the record keeps the count of the session event.
        if (kiroRequest && kiroSession && kiroStarted) {
          await setKiroSession(currentConversationId, {
            ...kiroSession,
            seenMessages: kiroRequest.history.length + 1,
            turns: undefined,
          }).catch((saveErr: unknown) =>
            console.error('Failed to save the Kiro session:', saveErr)
          );
        }
        // Keep whatever streamed before the error
        flushOnAbort?.();
        if (run.isActive()) {
          run.end('failed', (err as Error).message || 'Failed to send message');
          void notifyReply(currentConversationId, 'failed');
        }
      } finally {
        // After the last database write: a stop or a delete waits for it
        run.finish();
      }
    },
    [
      selectedModel,
      status,
      activeConversationId,
      shownMessages,
      maxTokens,
      maxToolSteps,
      thinkingEffort,
      enableWebSearch,
      createConversation,
      addMessage,
      getNextSequence,
      getConversation,
      getMessages,
      setKiroSession,
      setTitleFromKiro,
      onConversationChange,
    ]
  );

  // Regenerate response
  const regenerate = useCallback(
    async (assistantMessageIndex: number) => {
      if (isRunningStatus(status) || !selectedModel || !activeConversationId) return;
      const messages = shownMessages;

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

      const userContent = getTextContent(messages[userMessageIndex]);
      // The same files go again (D-G)
      const userFiles = filesOf(messages[userMessageIndex]);
      const history = messages.slice(0, userMessageIndex);

      // Drop the user message and everything after it (DB sequences are 1-based): sendMessage
      // adds the user message again, so the chat holds it once and sends it once
      await deleteMessagesFromSequence(activeConversationId, userMessageIndex + 1);
      replyStore.dismiss(activeConversationId);
      setMessages(history);

      // Re-send the user message with its files
      await sendMessage(userContent, userFiles, { conversationId: activeConversationId, history });
    },
    [
      status,
      selectedModel,
      shownMessages,
      activeConversationId,
      deleteMessagesFromSequence,
      sendMessage,
    ]
  );

  // Resend the last user message after a failed reply, with its files (D-G)
  const retryLast = useCallback(async () => {
    if (isRunningStatus(status) || !selectedModel || !activeConversationId) return;
    const messages = shownMessages;
    let lastUserIndex = -1;
    messages.forEach((m, i) => {
      if (m.role === 'user') lastUserIndex = i;
    });
    if (lastUserIndex === -1) return;
    const content = getTextContent(messages[lastUserIndex]);
    const files = filesOf(messages[lastUserIndex]);
    const history = messages.slice(0, lastUserIndex);
    // Drop the failed turn (DB sequences are 1-based) so it is not sent twice
    await deleteMessagesFromSequence(activeConversationId, lastUserIndex + 1);
    replyStore.dismiss(activeConversationId);
    setMessages(history);
    await sendMessage(content, files, { conversationId: activeConversationId, history });
  }, [
    status,
    selectedModel,
    activeConversationId,
    shownMessages,
    deleteMessagesFromSequence,
    sendMessage,
  ]);

  // Copy the conversation up to and including messageIndex into a new
  // conversation, switch to it, and send content there
  const forkAndSend = useCallback(
    async (messageIndex: number, content: string) => {
      if (!activeConversationId || !selectedModel || isRunningStatus(status)) return;

      const history = shownMessages.slice(0, messageIndex + 1);
      try {
        const forked = await forkConversation(activeConversationId, history.length);
        setInternalConversationId(forked.id);
        onConversationChange?.(forked.id);
        setMessages(history);
        await sendMessage(content, undefined, { conversationId: forked.id, history });
      } catch (err) {
        console.error('Fork failed:', err);
        replyStore.fail(
          activeConversationId,
          shownMessages,
          (err as Error).message || 'Failed to fork conversation'
        );
      }
    },
    [
      activeConversationId,
      selectedModel,
      status,
      shownMessages,
      forkConversation,
      onConversationChange,
      sendMessage,
    ]
  );

  // Rate a message. The same rating again clears it. The UI updates first; the DB follows.
  // The newest call for each message, so that only its failure rolls back
  const ratingCalls = useRef({ count: 0, latest: new Map<string, number>() });
  const rateMessage = useCallback(
    async (messageId: string, feedback: MessageFeedback) => {
      const current = shownMessages.find((m) => m.id === messageId)?.feedback;
      const next = current === feedback ? null : feedback;
      // The last call for a message wins: an older call that fails changes nothing
      const call = ++ratingCalls.current.count;
      ratingCalls.current.latest.set(messageId, call);
      const isLatest = () => ratingCalls.current.latest.get(messageId) === call;
      // The chat of this call: the rollback goes there, also after a switch
      const conversationId = activeConversationId;
      const change = (prev: UIMessage[]) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: next ?? undefined } : m));
      setMessages(change);
      // An ended reply that the chat still shows from the store
      if (conversationId) replyStore.editMessages(conversationId, change);
      try {
        await setMessageFeedback(messageId, next);
        toast.success(next ? 'Feedback saved' : 'Feedback removed');
      } catch (err) {
        console.error('Failed to save feedback:', err);
        toast.error('Could not save feedback');
        // A later call for this message has set its own value: keep it
        if (!isLatest()) return;
        // Undo the rating, unless something else changed it again
        const rollback = (prev: UIMessage[]) =>
          prev.map((m) =>
            m.id === messageId && m.feedback === (next ?? undefined)
              ? { ...m, feedback: current }
              : m
          );
        setMessages(rollback);
        if (conversationId) replyStore.editMessages(conversationId, rollback);
      } finally {
        if (isLatest()) ratingCalls.current.latest.delete(messageId);
      }
    },
    [shownMessages, activeConversationId, setMessageFeedback]
  );

  return {
    messages: shownMessages,
    status,
    error: reply?.error ?? null,
    wasInterrupted: reply?.wasInterrupted ?? false,
    streamStatus: reply?.streamStatus ?? null,
    sendMessage,
    regenerate,
    retryLast,
    forkAndSend,
    rateMessage,
    stopGeneration,
    clearMessages,
  };
}

/** One more Kiro turn, when the chat knows how many turns its session has (K7) */
function nextTurns(session: KiroConversationSession): { turns?: number } {
  return session.turns === undefined ? {} : { turns: session.turns + 1 };
}

/**
 * The `sessionOptions` event of the Kiro route (K9): keeps its lists for the session's controls,
 * stores its values with the chat, and ends the chat's picks. A bad event changes nothing.
 */
async function saveSessionOptionsEvent(
  raw: unknown,
  conversationId: string,
  sessionId: string
): Promise<void> {
  const snapshot = parseSessionOptionsSnapshot(raw);
  if (!snapshot) return;
  kiroService.rememberSessionOptions(sessionId, snapshot);
  await conversationService.setKiroSessionOptions(
    conversationId,
    sessionId,
    snapshotValues(snapshot)
  );
  // The session shows what it took: the picks that it took are done, the others stay
  clearPendingSessionOptions(conversationId, snapshotValues(snapshot));
}

/** An event that only comes once Kiro works on the message (K11) */
function isKiroTurnEvent(parsed: Record<string, unknown>): boolean {
  return [
    'content',
    'reasoning',
    'toolCall',
    'toolResult',
    'permission',
    'permissionResult',
    'title',
    'sessionUpdatedAt',
    'metadata',
  ].some((key) => parsed[key] !== undefined);
}

/** The `session` event of the Kiro route */
function isKiroSessionEvent(value: unknown): value is { id: string; created: boolean } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id.length > 0 && typeof v.created === 'boolean';
}

/** The format that the chat sends with a file, from its name and media type; undefined when the app cannot send it */
function formatOf(p: FilePart): string | undefined {
  return classifyFile(p.filename || 'file', p.mediaType || '').format;
}

/** The file parts of a message */
function fileParts(message: UIMessage): FilePart[] {
  return message.parts.filter((p): p is FilePart => p.type === 'file');
}

/** A message's files, to send again (regenerate, retry) */
function filesOf(message: UIMessage): ChatFile[] {
  return fileParts(message).flatMap((p) => {
    const format = formatOf(p);
    // A file type that the app no longer sends (an SVG from before): not sent again
    if (!format) return [];
    return [
      {
        name: p.filename || 'file',
        format,
        ...(p.data ? { bytes: p.data } : { size: p.size ?? 0 }),
      },
    ];
  });
}

/** A file of the chat input as the database stores it */
function toNewAttachment(file: ChatFile): NewAttachment {
  return {
    name: file.name,
    format: file.format,
    mediaType: getMediaTypeFromFormat(file.format),
    size: file.bytes ? base64Size(file.bytes) : (file.size ?? 0),
    ...(file.bytes && { data: base64ToBytes(file.bytes) }),
  };
}

/**
 * Mark the files of message `id` whose bytes the database did not keep (`kept`, in the order of
 * the file parts)
 */
function withFilesNotKept(messages: UIMessage[], id: string, kept: boolean[]): UIMessage[] {
  if (!kept.includes(false)) return messages;
  return messages.map((message) => {
    if (message.id !== id) return message;
    let i = 0;
    return {
      ...message,
      parts: message.parts.map((p) =>
        p.type === 'file' && kept[i++] === false ? { ...p, kept: false } : p
      ),
    };
  });
}

/** The line that stands for a file that the request does not carry (D-E) */
export const earlierFileLine = (name: string): string => `[Earlier file: ${name}]`;

/** The line for a file of the new message whose bytes the app did not keep */
export const notKeptFileLine = (name: string): string => `[File not kept: ${name}]`;

const utf8 = new TextEncoder();
/** The bytes of a value in the request's JSON */
const jsonSize = (value: unknown): number => utf8.encode(JSON.stringify(value)).length;

type SentFile = { name: string; format: string; bytes: string };

/**
 * The messages of a request. The new message's files always go. Earlier files go again, newest
 * first, while the whole history (texts, file lines, and files) fits in `REQUEST_BUDGET`; the
 * older ones, and earlier files whose bytes were not kept, go as a line `[Earlier file: name]`
 * in their message's text (D-E). A file of the new message without bytes goes as
 * `[File not kept: name]` and is not an earlier file. With `accepts`, an earlier file that the
 * current model cannot read goes as the same line and counts as not sent again (D-B).
 */
export function buildChatMessages(
  messages: UIMessage[],
  accepts?: FileAccepts
): {
  chatMessages: Array<{ role: UIMessage['role']; content: string; files: SentFile[] }>;
  filesNotResent: number;
} {
  // Messages with no text and no files are left out, as before
  const sent = messages.filter(
    (m) => getTextContent(m).trim().length > 0 || fileParts(m).length > 0
  );
  const last = sent.length - 1;
  const fileOf = (p: FilePart): SentFile => ({
    name: p.filename || 'file',
    format: formatOf(p) ?? '',
    bytes: p.data ?? '',
  });
  // An earlier file that the request can carry for this model
  const readable = (p: FilePart): boolean => {
    const info = classifyFile(p.filename || 'file', p.mediaType || '');
    return info.format !== undefined && (!accepts || acceptsKind(accepts, info.kind));
  };

  // First the parts that always go: every text and the new message's own files
  let room = REQUEST_BUDGET;
  for (const m of sent) room -= jsonSize({ role: m.role, content: getTextContent(m), files: [] });
  const newFiles = last >= 0 ? fileParts(sent[last]).filter((p) => p.data !== undefined) : [];
  for (const p of newFiles) room -= jsonSize(fileOf(p)) + 1;

  let full = false;
  let filesNotResent = 0;
  const chatMessages = sent
    .map((m, index) => ({ m, index }))
    .reverse()
    .map(({ m, index }) => {
      const files: SentFile[] = [];
      const lines: string[] = [];
      for (const p of fileParts(m)) {
        const name = p.filename || 'file';
        if (index === last) {
          if (p.data !== undefined) files.push(fileOf(p));
          else lines.push(notKeptFileLine(name));
          continue;
        }
        const cost = p.data === undefined ? 0 : jsonSize(fileOf(p)) + 1;
        if (!readable(p)) {
          // The current model cannot read it: a line, also before the budget is full
          const line = earlierFileLine(name);
          room -= utf8.encode(line).length + 2;
          lines.push(line);
          filesNotResent += 1;
        } else if (p.data !== undefined && !full && cost <= room) {
          room -= cost;
          files.push(fileOf(p));
        } else {
          // Past the budget every older file goes as a line too, so the newest ones go as bytes
          if (p.data !== undefined) full = true;
          const line = earlierFileLine(name);
          room -= utf8.encode(line).length + 2;
          lines.push(line);
          filesNotResent += 1;
        }
      }
      const text = getTextContent(m);
      return {
        role: m.role,
        content: lines.length > 0 ? `${text}\n\n${lines.join('\n')}` : text,
        files,
      };
    })
    .reverse();
  return { chatMessages, filesNotResent };
}
