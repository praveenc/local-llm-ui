/**
 * ChatContainer
 *
 * Main chat container using AI Elements components and useBedrockChat hook.
 * Supports all providers: Ollama, LM Studio, Bedrock, Bedrock Mantle, Anthropic, OpenRouter, Groq, and Cerebras.
 */

'use client';

import {
  ArrowUp,
  BookmarkPlus,
  Copy,
  Loader2,
  RefreshCw,
  Square,
  StopCircle,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { toast } from 'sonner';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

import type { MessageUsage } from '../../db/types';
import type { ProviderModels, UnifiedModel } from '../../hooks/useAllModels';
import { useBedrockChat } from '../../hooks/useBedrockChat';
import type { ToolCallPart, UIMessage } from '../../types/ai-messages';
import { getReasoningContent, getTextContent, hasReasoning } from '../../types/ai-messages';
import { summarizeChatUsage } from '../../utils/chatUsage';
import { normalizeMediaType } from '../../utils/fileUtils';
import { lookupFormat } from '../../utils/mediaTypes';
import { getModelContextLimits } from '../../utils/modelContext';
import { modelLabel } from '../../utils/modelLabel';
import { loadPreferences } from '../../utils/preferences';
import { formatQuoteMessage, quoteTagsToMarkdown } from '../../utils/quote';
import { isFocusComposerShortcut } from '../../utils/shortcuts';
import { supportsThinkingEffort, thinkingEffortOptions } from '../../utils/thinkingEffort';
import type { ThinkingEffort } from '../../utils/thinkingEffort';
import { formatCost, formatLatency, formatTokens } from '../../utils/usage';
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
  MessageAvatar,
  MessageContent,
  MessageResponse,
} from '../ai-elements/message';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '../ai-elements/prompt-input';
import { WorkRow } from '../ai-elements/work-row';
import { FittedContainer } from '../layout';
import { ChatErrorAlert } from './ChatErrorAlert';
import { ContextIndicator } from './ContextIndicator';
import { InferenceSettings } from './InferenceSettings';
import { MCPToolsIndicator } from './MCPToolsIndicator';
import { ModelSelectorButton } from './ModelSelectorButton';
import { ProviderChecklist } from './ProviderChecklist';
import { QuoteRespondDialog } from './QuoteRespondDialog';
import { type QuoteSelection, QuoteSelectionButton } from './QuoteSelectionButton';
import { SavePromptDialog } from './SavePromptDialog';
import { StreamStatusAnnouncer } from './StreamStatusAnnouncer';
import { ThinkingEffortSelector } from './ThinkingEffortSelector';
import { WebSearchToggle } from './WebSearchToggle';
import { composerCard, composerIconButton } from './composerStyles';

// Helper to extract tool calls from message parts
/** The reply has thinking or tool calls, so it has a work row */
const hasWork = (message: UIMessage | undefined) =>
  message?.role === 'assistant' &&
  message.parts.some((p) => p.type === 'reasoning' || p.type === 'tool-call');

/** The short label of the model that wrote a reply, for example "Claude Haiku 5.5 · Global" */
const replyModelLabel = (message: UIMessage): string | undefined =>
  message.model?.name
    ? modelLabel({
        provider: message.model.provider,
        id: message.model.id,
        name: message.model.name,
      }).label
    : undefined;

/**
 * Where the model changes: a map from the index of the turn that starts the reply (the user
 * message before it) to the new model's label. The first reply is not a change.
 */
function findModelSwitches(messages: UIMessage[]): Map<number, string> {
  const switches = new Map<number, string>();
  let previous: string | undefined;
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.model) return;
    const key = `${message.model.provider}:${message.model.id}`;
    if (previous !== undefined && key !== previous) {
      const label = replyModelLabel(message) ?? message.model.id;
      const turnStart = messages[index - 1]?.role === 'user' ? index - 1 : index;
      switches.set(turnStart, label);
    }
    previous = key;
  });
  return switches;
}

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
  /** 1-2 letters shown next to the user's messages. Empty: no avatar. */
  avatarInitials?: string;
  /** Set to a function that puts text into the chat input (saved prompts use it) */
  onInsertPromptRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** Opens Preferences on the Providers tab, from the first-run checklist and the picker */
  onOpenPreferences?: () => void;
  /** One line saying a model was picked automatically */
  autoSelectNote?: string;
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
  onInsertPromptRef,
  avatarInitials,
  onOpenPreferences,
  autoSelectNote,
}: BedrockChatContainerProps) => {
  const [inputValue, setInputValue] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [activeQuote, setActiveQuote] = useState<QuoteSelection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // The web search provider tried first; undefined when no web search key is set
  const prefs = loadPreferences();
  const primaryWebSearch = getPrimaryWebSearchProvider(prefs);

  const {
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

  // Context use and cost come from the usage stored with each reply, so they survive a reload
  const chatUsage = useMemo(() => summarizeChatUsage(messages), [messages]);
  const modelSwitches = useMemo(() => findModelSwitches(messages), [messages]);
  const isEmpty = messages.length === 0;
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  // Get context limits for current model
  const contextLimits = selectedModel
    ? getModelContextLimits(selectedModel.id, selectedModel.provider)
    : null;

  // "/" moves focus to the message box, unless the user is typing in another field
  const composerDisabled = isLoading || !selectedModel;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (composerDisabled || !isFocusComposerShortcut(e, e.target)) return;
      e.preventDefault();
      promptTextareaRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [composerDisabled]);

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

  // Let the sidebar put a saved prompt into the chat input
  useEffect(() => {
    if (!onInsertPromptRef) return;
    onInsertPromptRef.current = (text: string) => {
      setInputValue((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
      // Wait for the modal to close before moving focus
      setTimeout(() => promptTextareaRef.current?.focus(), 0);
    };
    return () => {
      onInsertPromptRef.current = null;
    };
  }, [onInsertPromptRef]);

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

  // One timer at a time, so an older timer cannot clear a newer error early
  const fileErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(fileErrorTimerRef.current), []);
  const handleFileError = (err: { code: string; message: string }) => {
    setFileError(err.message);
    clearTimeout(fileErrorTimerRef.current);
    fileErrorTimerRef.current = setTimeout(() => setFileError(null), 5000);
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      // The toast is announced by the global Toaster, like the other copy buttons
      toast.success('Copied');
    } catch (err) {
      console.error('Failed to copy:', err);
      toast.error('Copy failed');
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
      {error && (
        <ChatErrorAlert
          error={error}
          onRetry={selectedModel && externalConversationId ? () => void retryLast() : undefined}
          onChangeModel={() => setPickerOpen(true)}
        />
      )}
      {fileError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>File Error</AlertTitle>
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      )}
      <StreamStatusAnnouncer isLoading={isLoading} hasError={Boolean(error)} />
      <div className="relative flex flex-col h-full">
        <FittedContainer>
          <div className="h-full pb-44">
            {/* An empty chat has no transcript: the chat input sits in the middle instead */}
            {isEmpty ? null : (
              <div ref={messagesRef} className="h-full">
                <Conversation className="h-full max-w-3xl mx-auto">
                  <ConversationContent className="p-4 compact:p-3">
                    {messages.map((message, index) => {
                      const isLastMessage = index === messages.length - 1;
                      const toolCalls = getToolCalls(message);

                      const showAvatar = message.role === 'user' && !!avatarInitials;
                      const content = (
                        <MessageContent>
                          {(hasReasoning(message) || toolCalls.length > 0) && (
                            <WorkRow
                              reasoning={getReasoningContent(message) || undefined}
                              reasoningMs={message.reasoningMs}
                              toolCalls={toolCalls}
                              isRunning={isLastMessage && isLoading}
                              hasText={getTextContent(message).trim().length > 0}
                            />
                          )}
                          <MessageResponse className="reply-text">
                            {message.role === 'user'
                              ? quoteTagsToMarkdown(getTextContent(message))
                              : getTextContent(message)}
                          </MessageResponse>
                        </MessageContent>
                      );

                      const switchedTo = modelSwitches.get(index);
                      return (
                        <Fragment key={message.id}>
                          {switchedTo && <ModelSwitchDivider label={switchedTo} />}
                          <Message from={message.role} data-message-index={index}>
                            {showAvatar ? (
                              <div className="flex items-start justify-end gap-2">
                                {content}
                                <MessageAvatar initials={avatarInitials} className="mt-0.5" />
                              </div>
                            ) : (
                              content
                            )}
                          </Message>
                          {message.role === 'assistant' && !isLoading && (
                            <MessageActions className="ml-0 compact:-mt-1">
                              <MessageAction
                                tooltip="Helpful"
                                onClick={() => rateMessage(message.id, 'helpful')}
                              >
                                <ThumbsUp
                                  className={`h-3 w-3 ${message.feedback === 'helpful' ? 'fill-current' : ''}`}
                                />
                              </MessageAction>
                              <MessageAction
                                tooltip="Not helpful"
                                onClick={() => rateMessage(message.id, 'not-helpful')}
                              >
                                <ThumbsDown
                                  className={`h-3 w-3 ${message.feedback === 'not-helpful' ? 'fill-current' : ''}`}
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
                              {message.usage && (
                                <ReplyUsage
                                  usage={message.usage}
                                  cost={chatUsage.replyCosts.get(message.id)}
                                  model={replyModelLabel(message)}
                                />
                              )}
                            </MessageActions>
                          )}
                          {message.role === 'assistant' &&
                            index === lastAssistantIndex &&
                            wasInterrupted && <InterruptedIndicator />}
                        </Fragment>
                      );
                    })}
                    {/* The work row shows its own live step */}
                    {isLoading && !hasWork(messages[messages.length - 1]) && (
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
          onClose={() => {
            setActiveQuote(null);
            // The Quote and Ask button that opened the dialog is gone; go back to the message box
            setTimeout(() => promptTextareaRef.current?.focus(), 0);
          }}
          onSendToCompose={handleQuoteToCompose}
          onSendToFork={handleQuoteToFork}
          forkDisabledReason={forkDisabledReason}
        />
        {/*
         * The chat input: in the middle of an empty chat, under a heading, so you type where you
         * look; at the bottom once the chat has messages. It is one element, so the text and the
         * attachments stay when it moves. It moves without animation.
         */}
        <div
          className={cn(
            'absolute left-0 right-0 z-20 px-2 md:px-4',
            isEmpty
              ? 'inset-y-0 flex flex-col justify-center gap-4 overflow-y-auto pb-[12vh] pt-6 compact:gap-3'
              : 'bottom-0 bg-background pb-2 pt-2 md:pb-4'
          )}
        >
          {isEmpty && (
            <EmptyHeader
              selectedModel={selectedModel}
              providers={providers}
              isLoadingModels={isLoadingModels}
              onOpenPreferences={onOpenPreferences}
            />
          )}
          <PromptInput
            onSubmit={handleSubmit}
            onError={handleFileError}
            accept="image/*,.pdf,.txt,.html,.md,.csv,.doc,.docx,.xls,.xlsx"
            multiple
            maxFileSize={BEDROCK_DOC_MAX_SIZE}
            maxFiles={20}
            className="w-full max-w-3xl mx-auto"
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
              disabled={composerDisabled}
              aria-label="Message"
              aria-keyshortcuts="/"
              title="Message (press / to focus)"
              className="min-h-14 px-4 pt-4 pb-1 text-base leading-relaxed md:text-[15px] placeholder:text-muted-foreground"
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
                    <PromptInputActionMenuItem
                      disabled={isLoading || !inputValue.trim()}
                      onSelect={() => setSavePromptOpen(true)}
                    >
                      <BookmarkPlus className="mr-2 size-4" aria-hidden />
                      Save as prompt
                    </PromptInputActionMenuItem>
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <ModelSelectorButton
                  providers={providers}
                  selectedModel={selectedModel}
                  onSelectModel={onSelectModel}
                  isLoading={isLoadingModels}
                  disabled={isLoading}
                  onOpenPreferences={onOpenPreferences}
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
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
                      options={thinkingEffortOptions(selectedModel.provider, selectedModel.id)}
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
                {contextLimits && chatUsage.contextTokens > 0 && (
                  <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                )}
                {contextLimits && (
                  <ContextIndicator usage={chatUsage} maxTokens={contextLimits.contextWindow} />
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
          {isEmpty && selectedModel && autoSelectNote && (
            <p className="mx-auto max-w-3xl text-center text-sm text-muted-foreground">
              {autoSelectNote}
            </p>
          )}
        </div>
        <SavePromptDialog
          open={savePromptOpen}
          onOpenChange={setSavePromptOpen}
          text={inputValue}
        />
      </div>
    </>
  );
};

/** Above the chat input of an empty chat: a heading, or the provider checklist without a model */
const EmptyHeader = ({
  selectedModel,
  providers,
  isLoadingModels,
  onOpenPreferences,
}: {
  selectedModel: UnifiedModel | null;
  providers: ProviderModels[];
  isLoadingModels?: boolean;
  onOpenPreferences?: () => void;
}) =>
  selectedModel ? (
    <h2 className="mx-auto text-center text-2xl font-semibold text-foreground">
      What can I help with?
    </h2>
  ) : (
    <div className="mx-auto w-full max-w-3xl">
      <ProviderChecklist
        providers={providers}
        isLoading={isLoadingModels}
        onOpenPreferences={onOpenPreferences}
      />
    </div>
  );

/** Between two turns when the next reply comes from another model */
const ModelSwitchDivider = ({ label }: { label: string }) => (
  <div
    role="separator"
    aria-label={`Switched to ${label}`}
    className="flex items-center gap-3 py-1 text-xs text-muted-foreground"
  >
    <span aria-hidden className="h-px flex-1 bg-border" />
    <span aria-hidden>Switched to {label}</span>
    <span aria-hidden className="h-px flex-1 bg-border" />
  </div>
);

/** Tokens, time and cost of one reply, after its action buttons */
const ReplyUsage = ({
  usage,
  cost,
  model,
}: {
  usage: MessageUsage;
  cost?: number;
  model?: string;
}) => {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const calls = usage.steps?.length ?? 0;
  const details = [
    model ?? '',
    `Input: ${input.toLocaleString()} tokens`,
    usage.cacheReadTokens ? `${usage.cacheReadTokens.toLocaleString()} read from the cache` : '',
    `Output: ${output.toLocaleString()} tokens`,
    usage.reasoningTokens ? `${usage.reasoningTokens.toLocaleString()} reasoning` : '',
    calls > 1 ? `${calls} model calls` : '',
    cost !== undefined ? `Cost: ${formatCost(cost)}` : 'No price data',
  ].filter(Boolean);

  return (
    <p className="ml-2 text-xs tabular-nums text-muted-foreground" title={details.join(' · ')}>
      {formatTokens(input)} in · {formatTokens(output)} out
      {usage.latencyMs !== undefined && <> · {formatLatency(usage.latencyMs)}</>}
      {/* Free replies and fractions of a hundredth of a cent stay in the tooltip */}
      {cost !== undefined && cost >= 0.0001 && <> · {formatCost(cost)}</>}
    </p>
  );
};

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
      className="ml-1 size-11 md:size-8 rounded-full shadow-sm transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
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
  <div className="flex items-center gap-1.5 mt-2 text-muted-foreground">
    <StopCircle className="h-3.5 w-3.5" />
    <span className="text-[13px]">Response stopped</span>
  </div>
);

export default ChatContainer;
