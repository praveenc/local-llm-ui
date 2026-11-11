/**
 * ChatContainer
 *
 * Main chat container using AI Elements components and useBedrockChat hook.
 * Supports all providers: Ollama, LM Studio, Bedrock, Bedrock Mantle, Anthropic, OpenRouter, Groq, and Cerebras.
 */

'use client';

import {
  ArrowUp,
  Bot,
  Copy,
  Loader2,
  RefreshCw,
  Square,
  StopCircle,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';

import { Fragment, useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

import type { ProviderModels, UnifiedModel } from '../../hooks/useAllModels';
import { useBedrockChat } from '../../hooks/useBedrockChat';
import type { ToolCallPart } from '../../types/ai-messages';
import { getReasoningContent, getTextContent, hasReasoning } from '../../types/ai-messages';
import { normalizeMediaType } from '../../utils/fileUtils';
import { lookupFormat } from '../../utils/mediaTypes';
import { getModelContextLimits } from '../../utils/modelContext';
import { loadPreferences } from '../../utils/preferences';
import { formatQuoteMessage, quoteTagsToMarkdown } from '../../utils/quote';
import { supportsThinkingEffort } from '../../utils/thinkingEffort';
import type { ThinkingEffort } from '../../utils/thinkingEffort';
import { WEB_SEARCH_PROVIDER_LABELS, getPrimaryWebSearchProvider } from '../../utils/webSearch';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '../ai-elements/message';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '../ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../ai-elements/reasoning';
import { ToolCall } from '../ai-elements/tool-call';
import { FittedContainer } from '../layout';
import { ActiveModelBadge } from './ActiveModelBadge';
import { ChatErrorAlert } from './ChatErrorAlert';
import { ContextIndicator } from './ContextIndicator';
import { InferenceSettings } from './InferenceSettings';
import { MCPToolsIndicator } from './MCPToolsIndicator';
import { ModelSelectorButton } from './ModelSelectorButton';
import { QuoteRespondDialog } from './QuoteRespondDialog';
import { type QuoteSelection, QuoteSelectionButton } from './QuoteSelectionButton';
import { ThinkingEffortSelector } from './ThinkingEffortSelector';
import { WebSearchToggle } from './WebSearchToggle';
import { composerCard, composerIconButton } from './composerStyles';

// Helper to extract tool calls from message parts
const getToolCalls = (message: { parts: Array<{ type: string }> }): ToolCallPart[] => {
  return message.parts.filter((p): p is ToolCallPart => p.type === 'tool-call');
};

// Bedrock file size limits
const BEDROCK_DOC_MAX_SIZE = 4.5 * 1024 * 1024; // 4.5MB for documents

interface BedrockChatContainerProps {
  // Model selection via ModelSelector
  providers: ProviderModels[];
  selectedModel: UnifiedModel | null;
  onSelectModel: (model: UnifiedModel) => void;
  isLoadingModels?: boolean;
  // Chat parameters
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  maxToolSteps: number;
  setMaxToolSteps: (steps: number) => void;
  thinkingEffort: ThinkingEffort;
  setThinkingEffort: (effort: ThinkingEffort) => void;
  conversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
  onClearHistoryRef?: React.MutableRefObject<(() => void) | null>;
}

// File format for a browser media type; null for an unsupported binary type
function getFormatFromMediaType(mediaType: string): string | null {
  // Normalize text-like MIME types to Bedrock-supported ones
  const normalized = normalizeMediaType(mediaType);
  if (!normalized) return null;
  return lookupFormat(normalized) ?? 'txt';
}

const ChatContainer = ({
  providers,
  selectedModel,
  onSelectModel,
  isLoadingModels,
  maxTokens,
  setMaxTokens,
  maxToolSteps,
  setMaxToolSteps,
  thinkingEffort,
  setThinkingEffort,
  conversationId: externalConversationId,
  onConversationChange,
  onClearHistoryRef,
}: BedrockChatContainerProps) => {
  const [inputValue, setInputValue] = useState('');
  const [messageFeedback, setMessageFeedback] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [activeQuote, setActiveQuote] = useState<QuoteSelection | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // The web search provider tried first; undefined when no web search key is set
  const prefs = loadPreferences();
  const primaryWebSearch = getPrimaryWebSearchProvider(prefs);

  const {
    messages,
    status,
    error,
    metadata,
    cumulativeUsage,
    wasInterrupted,
    sendMessage,
    regenerate,
    forkAndSend,
    stopGeneration,
    clearMessages,
    resetUsage,
  } = useBedrockChat({
    conversationId: externalConversationId ?? null,
    selectedModel,
    maxTokens,
    maxToolSteps,
    thinkingEffort,
    enableWebSearch,
    onConversationChange,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  // Get context limits for current model
  const contextLimits = selectedModel
    ? getModelContextLimits(selectedModel.id, selectedModel.provider)
    : null;

  // Reset usage when model changes
  const prevModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedModel && prevModelRef.current !== selectedModel.id) {
      if (prevModelRef.current !== null) {
        // Model changed, reset usage
        resetUsage();
      }
      prevModelRef.current = selectedModel.id;
    }
  }, [selectedModel, resetUsage]);

  // Connect clearMessages to parent's ref for "New Conversation" button
  useEffect(() => {
    if (onClearHistoryRef) {
      onClearHistoryRef.current = clearMessages;
    }
    return () => {
      if (onClearHistoryRef) {
        onClearHistoryRef.current = null;
      }
    };
  }, [onClearHistoryRef, clearMessages]);

  const handleSubmit = async (message: {
    text: string;
    files: Array<{ url?: string; mediaType?: string; filename?: string }>;
  }) => {
    // Allow submit with files even without text
    if (!message.text.trim() && message.files.length === 0) return;
    if (isLoading) return;

    setInputValue('');
    setFileError(null);

    if (message.files.length > 0) {
      const filesWithData = await Promise.all(
        message.files.map(async (f) => {
          if (f.url?.startsWith('data:')) {
            const base64 = f.url.split(',')[1] || '';
            const format = getFormatFromMediaType(f.mediaType || '');
            if (!format) {
              return null; // unsupported MIME type
            }
            return {
              name: f.filename || 'file',
              format,
              bytes: base64,
            };
          }
          return null;
        })
      );
      const validFiles = filesWithData.filter(
        (f): f is { name: string; format: string; bytes: string } => f !== null
      );
      if (validFiles.length === 0 && message.files.length > 0) {
        setFileError(
          'Unsupported file type. Supported: PDF, TXT, HTML, MD, CSV, DOC, DOCX, XLS, XLSX, and images.'
        );
        return;
      }
      // Use default text if only files are provided
      const text = message.text.trim() || 'Please analyze the attached file(s).';
      await sendMessage(text, validFiles);
    } else {
      await sendMessage(message.text);
    }
  };

  const handleFileError = (err: { code: string; message: string }) => {
    setFileError(err.message);
    // Clear error after 5 seconds
    setTimeout(() => setFileError(null), 5000);
  };

  const handleFeedback = (messageId: string, feedbackType: string) => {
    setMessageFeedback((prev) => ({ ...prev, [messageId]: feedbackType }));
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleQuoteToCompose = (response: string) => {
    if (!activeQuote) return;
    const quoted = formatQuoteMessage(activeQuote.text, response);
    setInputValue((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${quoted}` : quoted));
    setActiveQuote(null);
    // Wait for the dialog to close before moving focus
    setTimeout(() => promptTextareaRef.current?.focus(), 0);
  };

  const handleQuoteToFork = async (response: string) => {
    if (!activeQuote) return;
    const { text, messageIndex } = activeQuote;
    setActiveQuote(null);
    await forkAndSend(messageIndex, formatQuoteMessage(text, response));
  };

  const forkDisabledReason = isLoading
    ? 'wait for the current response to finish'
    : !externalConversationId
      ? 'this conversation is not saved yet'
      : !selectedModel
        ? 'select a model first'
        : undefined;

  const lastAssistantIndex = messages.reduce(
    (lastIdx, msg, idx) => (msg.role === 'assistant' ? idx : lastIdx),
    -1
  );

  return (
    <>
      {error && <ChatErrorAlert error={error} />}
      {fileError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>File Error</AlertTitle>
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      )}
      <div className="relative flex flex-col h-full">
        <FittedContainer>
          <div className="h-full pb-44">
            {messages.length === 0 ? (
              <EmptyState selectedModel={selectedModel} />
            ) : (
              <div ref={messagesRef} className="h-full">
                <Conversation className="h-full max-w-4xl mx-auto">
                  <ConversationContent className="p-4">
                    {selectedModel && <ActiveModelBadge model={selectedModel} />}
                    {messages.map((message, index) => {
                      // Determine if this message's reasoning is still streaming
                      const isLastMessage = index === messages.length - 1;
                      const isReasoningStreaming =
                        isLastMessage &&
                        isLoading &&
                        hasReasoning(message) &&
                        !getTextContent(message);

                      return (
                        <Fragment key={message.id}>
                          <Message from={message.role} data-message-index={index}>
                            <MessageContent>
                              {hasReasoning(message) && (
                                <Reasoning
                                  className="w-full"
                                  isStreaming={isReasoningStreaming}
                                  defaultOpen={false}
                                >
                                  <ReasoningTrigger />
                                  <ReasoningContent>
                                    {getReasoningContent(message) || ''}
                                  </ReasoningContent>
                                </Reasoning>
                              )}
                              {getToolCalls(message).map((toolCall) => (
                                <ToolCall key={toolCall.toolCallId} toolCall={toolCall} />
                              ))}
                              <MessageResponse>
                                {message.role === 'user'
                                  ? quoteTagsToMarkdown(getTextContent(message))
                                  : getTextContent(message)}
                              </MessageResponse>
                            </MessageContent>
                          </Message>
                          {message.role === 'assistant' && !isLoading && (
                            <MessageActions className="ml-0">
                              <MessageAction
                                tooltip="Helpful"
                                onClick={() => handleFeedback(message.id, 'helpful')}
                              >
                                <ThumbsUp
                                  className={`h-3 w-3 ${messageFeedback[message.id] === 'helpful' ? 'fill-current' : ''}`}
                                />
                              </MessageAction>
                              <MessageAction
                                tooltip="Not helpful"
                                onClick={() => handleFeedback(message.id, 'not-helpful')}
                              >
                                <ThumbsDown
                                  className={`h-3 w-3 ${messageFeedback[message.id] === 'not-helpful' ? 'fill-current' : ''}`}
                                />
                              </MessageAction>
                              <MessageAction
                                tooltip="Copy"
                                onClick={() => handleCopy(getTextContent(message))}
                              >
                                <Copy className="h-3 w-3" />
                              </MessageAction>
                              <MessageAction
                                tooltip="Regenerate"
                                onClick={() => regenerate(index)}
                                disabled={isLoading}
                              >
                                <RefreshCw className="h-3 w-3" />
                              </MessageAction>
                            </MessageActions>
                          )}
                          {message.role === 'assistant' &&
                            index === lastAssistantIndex &&
                            metadata && <MetadataRow metadata={metadata} />}
                          {message.role === 'assistant' &&
                            index === lastAssistantIndex &&
                            wasInterrupted && <InterruptedIndicator />}
                        </Fragment>
                      );
                    })}
                    {isLoading && !hasReasoning(messages[messages.length - 1] || { parts: [] }) && (
                      <GeneratingIndicator />
                    )}
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
              </div>
            )}
          </div>
        </FittedContainer>
        <QuoteSelectionButton
          containerRef={messagesRef}
          onQuote={setActiveQuote}
          disabled={activeQuote !== null}
        />
        <QuoteRespondDialog
          quote={activeQuote?.text ?? null}
          onClose={() => setActiveQuote(null)}
          onSendToCompose={handleQuoteToCompose}
          onSendToFork={handleQuoteToFork}
          forkDisabledReason={forkDisabledReason}
        />
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-linear-to-t from-background from-60% to-transparent px-2 pb-2 pt-6 md:px-4 md:pb-4">
          <PromptInput
            onSubmit={handleSubmit}
            onError={handleFileError}
            accept="image/*,.pdf,.txt,.html,.md,.csv,.doc,.docx,.xls,.xlsx"
            multiple
            maxFileSize={BEDROCK_DOC_MAX_SIZE}
            maxFiles={20}
            className="max-w-4xl mx-auto"
            inputGroupClassName={composerCard}
          >
            <PromptInputHeader className="px-3 pb-0 pt-3 empty:hidden">
              <PromptInputAttachments className="p-0">
                {(attachment) => (
                  <PromptInputAttachment
                    data={attachment}
                    className="rounded-lg bg-muted/60 font-normal"
                  />
                )}
              </PromptInputAttachments>
            </PromptInputHeader>
            <PromptInputTextarea
              ref={promptTextareaRef}
              value={inputValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setInputValue(e.target.value)
              }
              placeholder={
                selectedModel ? 'What would you like to know?' : 'Select a model to start chatting'
              }
              disabled={isLoading || !selectedModel}
              className="min-h-14 px-4 pt-4 pb-1 text-base leading-relaxed md:text-[15px] placeholder:text-muted-foreground/80"
            />
            <PromptInputFooter className="flex-wrap gap-y-1 px-2.5 pb-2.5 pt-1">
              <PromptInputTools className="min-w-0 flex-wrap gap-0.5">
                <PromptInputActionMenu modal={false}>
                  <PromptInputActionMenuTrigger
                    className={composerIconButton}
                    aria-label="Add photos or files"
                  />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="Add photos or files" />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <ModelSelectorButton
                  providers={providers}
                  selectedModel={selectedModel}
                  onSelectModel={onSelectModel}
                  isLoading={isLoadingModels}
                  disabled={isLoading}
                />
                {selectedModel &&
                  supportsThinkingEffort(
                    selectedModel.provider,
                    selectedModel.id,
                    selectedModel.supportsThinking
                  ) && (
                    <ThinkingEffortSelector
                      value={thinkingEffort}
                      onChange={setThinkingEffort}
                      disabled={isLoading}
                    />
                  )}
              </PromptInputTools>
              <PromptInputTools className="ml-auto gap-0.5">
                <WebSearchToggle
                  enabled={enableWebSearch}
                  onToggle={setEnableWebSearch}
                  disabled={isLoading}
                  hasApiKey={primaryWebSearch !== undefined}
                  providerLabel={primaryWebSearch && WEB_SEARCH_PROVIDER_LABELS[primaryWebSearch]}
                />
                <MCPToolsIndicator disabled={isLoading} />
                <InferenceSettings
                  maxTokens={maxTokens}
                  setMaxTokens={setMaxTokens}
                  maxToolSteps={maxToolSteps}
                  setMaxToolSteps={setMaxToolSteps}
                  disabled={isLoading}
                />
                {(messages.length > 0 || (contextLimits && cumulativeUsage.totalTokens > 0)) && (
                  <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                )}
                {messages.length > 0 && (
                  <PromptInputButton
                    onClick={clearMessages}
                    disabled={isLoading}
                    className={cn(composerIconButton, 'hover:text-destructive')}
                    aria-label="Clear chat"
                    title="Clear chat"
                  >
                    <Trash2 className="size-4" />
                  </PromptInputButton>
                )}
                {contextLimits && cumulativeUsage.totalTokens > 0 && (
                  <ContextIndicator
                    usedTokens={cumulativeUsage.totalTokens}
                    maxTokens={contextLimits.contextWindow}
                    inputTokens={cumulativeUsage.inputTokens}
                    outputTokens={cumulativeUsage.outputTokens}
                    modelId={contextLimits.tokenlensModelId || undefined}
                  />
                )}
                <PromptInputSubmitWithAttachments
                  inputValue={inputValue}
                  selectedModel={selectedModel}
                  isLoading={isLoading}
                  stopGeneration={stopGeneration}
                />
              </PromptInputTools>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
};

const EmptyState = ({ selectedModel }: { selectedModel: UnifiedModel | null }) => (
  <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
    {selectedModel ? (
      <>
        <Bot className="h-16 w-16 text-muted-foreground/50" />
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">Ready to chat</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Send a message to start chatting with <strong>{selectedModel.name}</strong>
          </p>
        </div>
      </>
    ) : (
      <>
        <Bot className="h-16 w-16 text-muted-foreground/50" />
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">No model selected</h3>
          <p className="text-sm text-muted-foreground mt-1">Select a model to begin chatting</p>
        </div>
      </>
    )}
  </div>
);

const MetadataRow = ({
  metadata,
}: {
  metadata: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  };
}) => (
  <div className="flex justify-start mt-2">
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <Bot className="h-3 w-3" />
        <span>Generated by AI</span>
      </div>
      <span className="text-border">|</span>
      <div className="flex items-center gap-3">
        {metadata.inputTokens !== undefined && (
          <span>↑ Input: {metadata.inputTokens.toLocaleString()} tokens</span>
        )}
        {metadata.outputTokens !== undefined && (
          <span>↓ Output: {metadata.outputTokens.toLocaleString()} tokens</span>
        )}
        {metadata.totalTokens !== undefined && (
          <span>= Total: {metadata.totalTokens.toLocaleString()} tokens</span>
        )}
        {metadata.latencyMs !== undefined && <span>⏱ {metadata.latencyMs}ms</span>}
      </div>
    </div>
  </div>
);

// Submit button that checks both text input and attachments
const PromptInputSubmitWithAttachments = ({
  inputValue,
  selectedModel,
  isLoading,
  stopGeneration,
}: {
  inputValue: string;
  selectedModel: UnifiedModel | null;
  isLoading: boolean;
  stopGeneration: () => void;
}) => {
  const attachments = usePromptInputAttachments();
  const hasContent = inputValue.trim().length > 0 || attachments.files.length > 0;

  // When streaming, the stop button should always be enabled
  // When not streaming, require content and a selected model
  const isDisabled = isLoading ? false : !hasContent || !selectedModel;

  return (
    <PromptInputSubmit
      status={isLoading ? 'streaming' : 'ready'}
      disabled={isDisabled}
      onClick={isLoading ? stopGeneration : undefined}
      className="ml-1 size-8 rounded-full shadow-sm transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
    >
      {isLoading ? (
        <Square className="size-3 fill-current" />
      ) : (
        <ArrowUp className="size-4" strokeWidth={2.5} />
      )}
    </PromptInputSubmit>
  );
};

// Loading indicator shown during AI response generation
const GeneratingIndicator = () => (
  <div className="flex items-center gap-2 py-2">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Generating response...</span>
    </div>
  </div>
);

// Indicator shown when response generation was manually stopped
const InterruptedIndicator = () => (
  <div className="flex items-center gap-1.5 mt-2 text-muted-foreground/70">
    <StopCircle className="h-3 w-3" />
    <span className="text-xs italic">Response stopped</span>
  </div>
);

export default ChatContainer;
