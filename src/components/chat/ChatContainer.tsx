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

import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

import type { MessageUsage, Provider } from '../../db/types';
import type { ProviderModels, UnifiedModel } from '../../hooks/useAllModels';
import { useBedrockChat } from '../../hooks/useBedrockChat';
import { useSessionOptions } from '../../hooks/useSessionOptions';
import type { FilePart, ToolCallPart, UIMessage } from '../../types/ai-messages';
import {
  base64ToBytes,
  getReasoningContent,
  getTextContent,
  hasReasoning,
} from '../../types/ai-messages';
import {
  MAX_FILE_BYTES,
  acceptList,
  acceptsAnyFile,
  acceptsKind,
  classifyFile,
  fileAccepts,
  fileTooLargeReason,
  messageLimitReason,
  notAcceptedReason,
} from '../../utils/attachments';
import type { FileAccepts, FileKind } from '../../utils/attachments';
import { summarizeChatUsage } from '../../utils/chatUsage';
import { formatCredits } from '../../utils/kiroModels';
import { getModelContextLimits } from '../../utils/modelContext';
import { modelLabel } from '../../utils/modelLabel';
import { formatQuoteMessage, quoteTagsToMarkdown } from '../../utils/quote';
import { isFocusComposerShortcut } from '../../utils/shortcuts';
import { supportsThinkingEffort, thinkingEffortOptions } from '../../utils/thinkingEffort';
import type { ThinkingEffort } from '../../utils/thinkingEffort';
import { formatCost, formatLatency, formatTokens } from '../../utils/usage';
import type { WebSearchState } from '../../utils/webSearch';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageAttachment,
  MessageAttachments,
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
import { SessionAgentPicker } from './SessionAgentPicker';
import { SessionOptionsMenu } from './SessionOptionsMenu';
import { StreamStatusAnnouncer } from './StreamStatusAnnouncer';
import { ThinkingEffortSelector } from './ThinkingEffortSelector';
import { WebSearchToggle } from './WebSearchToggle';
import {
  composerCard,
  composerIconButton,
  composerTextarea,
  composerTextareaBottom,
  composerTextareaEmpty,
} from './composerStyles';

// Helper to extract tool calls from message parts
/** The reply has thinking or tool calls, so it has a work row */
const hasWork = (message: UIMessage | undefined) =>
  message?.role === 'assistant' &&
  message.parts.some((p) => p.type === 'reasoning' || p.type === 'tool-call');

/** Height of the chat input before it is measured, and the strip above it for the scroll button */
const DEFAULT_COMPOSER_HEIGHT = 128;
const SCROLL_BUTTON_STRIP = 48;

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

/** Shown when files are added to a Kiro chat */
const KIRO_NO_FILES = 'Kiro does not take files yet. Send the text without them.';

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
  /** Web search of the open chat. Without it, the globe button does not show. */
  webSearch?: WebSearchState;
  /** Primary web search provider, shown in the globe button tooltip */
  webSearchProviderLabel?: string;
  /** The globe button: turns web search on or off for the open chat */
  onToggleWebSearch?: () => void;
  conversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
  onClearHistoryRef?: React.MutableRefObject<(() => void) | null>;
  /** 1-2 letters shown next to the user's messages. Empty: no avatar. */
  avatarInitials?: string;
  /** Set to a function that puts text into the chat input (saved prompts use it) */
  onInsertPromptRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** Opens Preferences on the Providers tab, from the first-run checklist and the picker */
  onOpenPreferences?: () => void;
  /** Default provider from Preferences: its models show first in the picker when no model is selected */
  defaultProvider?: Provider;
  /** One line saying a model was picked automatically */
  autoSelectNote?: string;
}

/** The file types that a model reads: from the model list, else from the provider table */
function modelAccepts(model: UnifiedModel | null): FileAccepts {
  return model?.accepts ?? fileAccepts(model?.provider);
}

/** Why a file cannot be added for this model, or null when it can (D-B, D-H) */
function fileRefusal(
  model: UnifiedModel | null,
  accepts: FileAccepts,
  name: string,
  mediaType: string
): { reason: string } | { kind: FileKind } {
  const info = classifyFile(name, mediaType);
  if (info.kind === 'unsupported') return { reason: info.reason ?? `${name} cannot be sent.` };
  if (!acceptsKind(accepts, info.kind)) {
    return model?.provider === 'kiro'
      ? { reason: KIRO_NO_FILES }
      : { reason: notAcceptedReason(model?.provider, accepts, name, info.kind) };
  }
  return { kind: info.kind };
}

/**
 * The composer's check of added files: the type that the model reads, 4.5 MB a file, and the
 * limits of a message (D-H). Each refused file has its reason in words.
 */
function checkComposerFiles(
  model: UnifiedModel | null,
  incoming: File[],
  current: Array<{ filename?: string; mediaType?: string; size?: number }>
): { accepted: File[]; errors: string[] } {
  const accepts = modelAccepts(model);
  const kept = current.map((f) => ({
    kind: classifyFile(f.filename ?? '', f.mediaType ?? '').kind,
    size: f.size ?? 0,
  }));
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of incoming) {
    const result = fileRefusal(model, accepts, file.name, file.type);
    if ('reason' in result) {
      if (!errors.includes(result.reason)) errors.push(result.reason);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(fileTooLargeReason(file.name));
      continue;
    }
    const next = [...kept, { kind: result.kind, size: file.size }];
    const limit = messageLimitReason(next);
    if (limit) {
      const text = `${limit} ${file.name} was not added.`;
      errors.push(text);
      continue;
    }
    kept.push({ kind: result.kind, size: file.size });
    accepted.push(file);
  }
  return { accepted, errors };
}

/** The files in the composer that this model cannot read (after a model switch) */
function unreadableFiles(
  model: UnifiedModel | null,
  files: Array<{ filename?: string; mediaType?: string }>
): string[] {
  const accepts = modelAccepts(model);
  return files
    .filter((f) => 'reason' in fileRefusal(model, accepts, f.filename ?? '', f.mediaType ?? ''))
    .map((f) => f.filename || 'file');
}

/** The message that blocks the send, naming the files */
function blockedFilesMessage(model: UnifiedModel | null, names: string[]): string {
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')}${names.length > 2 ? ',' : ''} and ${names.at(-1)}`;
  const it = names.length === 1 ? 'it' : 'them';
  const who = model ? 'This model' : 'With no model selected, the chat';
  return `${who} cannot read ${list}. Remove ${it} or pick a different model to send.`;
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
  webSearch,
  webSearchProviderLabel,
  onToggleWebSearch,
  conversationId: externalConversationId,
  onConversationChange,
  onClearHistoryRef,
  onInsertPromptRef,
  avatarInitials,
  onOpenPreferences,
  defaultProvider,
  autoSelectNote,
}: BedrockChatContainerProps) => {
  const [inputValue, setInputValue] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [activeQuote, setActiveQuote] = useState<QuoteSelection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // False when the provider reports that the model cannot use tools (Ollama); unknown counts as yes
  const toolsSupported = selectedModel?.supportsTools !== false;
  // Kiro brings its own tools and takes no files, web search, MCP servers, or inference settings
  const isKiro = selectedModel?.provider === 'kiro';
  // The file types that the selected model reads (D-A c); none: no "Add photos or files"
  const accepts = modelAccepts(selectedModel);
  const takesFiles = acceptsAnyFile(accepts);
  // Files in the composer that the selected model cannot read: the send waits (D-B)
  const [blockedFiles, setBlockedFiles] = useState<string[]>([]);

  const {
    messages,
    status,
    error,
    wasInterrupted,
    streamStatus,
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
    enableWebSearch: !isKiro && (webSearch?.send ?? false),
    onConversationChange,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  // The harness's agent and other session options (K9), picked by ACP category, not by id
  const {
    snapshot: sessionOptions,
    pick: pickSessionOption,
    refreshLists: refreshSessionLists,
  } = useSessionOptions(externalConversationId ?? null);
  const agentOption = isKiro ? sessionOptions?.mode : undefined;
  const otherOptions = isKiro ? (sessionOptions?.options ?? []) : [];

  // Context use and cost come from the usage stored with each reply, so they survive a reload
  const chatUsage = useMemo(
    () => summarizeChatUsage(messages, selectedModel),
    [messages, selectedModel]
  );
  const modelSwitches = useMemo(() => findModelSwitches(messages), [messages]);
  const isEmpty = messages.length === 0;

  // The transcript ends above the chat input, with a strip for the scroll-to-bottom button. The
  // input grows with its text and wraps its toolbar on narrow screens, so measure it.
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_HEIGHT);
  useEffect(() => {
    const el = composerRef.current;
    if (isEmpty || !el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setComposerHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isEmpty]);
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  // Get context limits for current model. Kiro reports a percentage instead.
  const contextLimits =
    selectedModel && !isKiro
      ? getModelContextLimits(selectedModel.id, selectedModel.provider)
      : null;
  // The totals show for any chat with replies, also with another model or no model selected
  const showContext = chatUsage.totals.replies > 0;

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

    // Files that this model cannot read (a model switch): keep them and the text, and wait
    const unreadable = unreadableFiles(selectedModel, message.files);
    if (unreadable.length > 0) {
      setBlockedFiles(unreadable);
      // A rejected submit keeps the files in the composer
      throw new Error('Files not readable by this model');
    }

    setInputValue('');
    setFileError(null);

    if (message.files.length > 0) {
      const files = message.files.flatMap((f) => {
        if (!f.url?.startsWith('data:')) return [];
        const name = f.filename || 'file';
        const { format } = classifyFile(name, f.mediaType || '');
        if (!format) return [];
        return [{ name, format, bytes: f.url.split(',')[1] || '' }];
      });
      // Only files: the stored text is empty; the server adds a neutral text if a provider needs one
      await sendMessage(message.text.trim(), files);
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
      {(fileError || blockedFiles.length > 0) && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>File Error</AlertTitle>
          {fileError && <AlertDescription>{fileError}</AlertDescription>}
          {blockedFiles.length > 0 && (
            <AlertDescription>{blockedFilesMessage(selectedModel, blockedFiles)}</AlertDescription>
          )}
        </Alert>
      )}
      <StreamStatusAnnouncer isLoading={isLoading} hasError={Boolean(error)} />
      <div className="relative flex flex-col h-full">
        <FittedContainer>
          <div className="h-full" style={{ paddingBottom: composerHeight + SCROLL_BUTTON_STRIP }}>
            {/* An empty chat has no transcript: the chat input sits in the middle instead */}
            {isEmpty ? null : (
              <div ref={messagesRef} className="h-full">
                {/* Visible overflow: the scroll button sits in the strip under the transcript */}
                <Conversation className="h-full max-w-3xl mx-auto overflow-y-visible">
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
                              provider={message.model?.provider}
                            />
                          )}
                          <MessageResponse className="reply-text">
                            {message.role === 'user'
                              ? quoteTagsToMarkdown(getTextContent(message))
                              : getTextContent(message)}
                          </MessageResponse>
                        </MessageContent>
                      );

                      const files = message.parts.filter((p): p is FilePart => p.type === 'file');
                      const switchedTo = modelSwitches.get(index);
                      return (
                        <Fragment key={message.id}>
                          {switchedTo && <ModelSwitchDivider label={switchedTo} />}
                          <Message from={message.role} data-message-index={index}>
                            {message.role === 'user' && files.length > 0 && (
                              <MessageFiles files={files} />
                            )}
                            {showAvatar ? (
                              <div className="flex items-start justify-end gap-2">
                                {content}
                                <MessageAvatar initials={avatarInitials} className="mt-0.5" />
                              </div>
                            ) : (
                              content
                            )}
                          </Message>
                          {message.role === 'assistant' && !!message.filesNotResent && (
                            <FilesNotResentNote count={message.filesNotResent} />
                          )}
                          {message.role === 'assistant' && !isLoading && (
                            <MessageActions className="ml-0 compact:-mt-1">
                              <MessageAction
                                tooltip="Helpful"
                                onClick={() => rateMessage(message.id, 'helpful')}
                              >
                                <ThumbsUp
                                  className={`size-4 ${message.feedback === 'helpful' ? 'fill-current' : ''}`}
                                />
                              </MessageAction>
                              <MessageAction
                                tooltip="Not helpful"
                                onClick={() => rateMessage(message.id, 'not-helpful')}
                              >
                                <ThumbsDown
                                  className={`size-4 ${message.feedback === 'not-helpful' ? 'fill-current' : ''}`}
                                />
                              </MessageAction>
                              <MessageAction
                                tooltip="Copy"
                                onClick={() => handleCopy(getTextContent(message))}
                              >
                                <Copy className="size-4" />
                              </MessageAction>
                              {/* Kiro keeps its own history, so a Kiro reply cannot be redone (D12) */}
                              {message.model?.provider !== 'kiro' && (
                                <MessageAction
                                  tooltip="Regenerate"
                                  onClick={() => regenerate(index)}
                                  disabled={isLoading}
                                >
                                  <RefreshCw className="size-4" />
                                </MessageAction>
                              )}
                              {message.usage &&
                                (message.model?.provider === 'kiro' ? (
                                  <KiroReplyUsage
                                    usage={message.usage}
                                    model={replyModelLabel(message)}
                                  />
                                ) : (
                                  <ReplyUsage
                                    usage={message.usage}
                                    cost={chatUsage.replyCosts.get(message.id)}
                                    model={replyModelLabel(message)}
                                  />
                                ))}
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
                      <GeneratingIndicator status={streamStatus} />
                    )}
                  </ConversationContent>
                  <ConversationScrollButton className="bottom-0 size-8 translate-y-[calc(100%+0.5rem)]" />
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
          ref={composerRef}
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
            // The file dialog shows the types that the model reads; a drop or a paste of
            // another type is refused with the reason in words (D-B)
            accept={acceptList(accepts) || undefined}
            multiple
            checkFiles={(incoming, current) => checkComposerFiles(selectedModel, incoming, current)}
            className="@container w-full max-w-3xl mx-auto"
            inputGroupClassName={composerCard}
          >
            <BlockedFilesWatch model={selectedModel} onChange={setBlockedFiles} />
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
              className={cn(
                composerTextarea,
                isEmpty ? composerTextareaEmpty : composerTextareaBottom
              )}
            />
            <PromptInputFooter className="flex-wrap gap-y-1 px-3 pb-3 pt-1">
              <PromptInputTools className="min-w-0 flex-wrap gap-1">
                <PromptInputActionMenu modal={false}>
                  <PromptInputActionMenuTrigger
                    className={composerIconButton}
                    // A model that takes no file: the menu holds only Save as prompt
                    aria-label={takesFiles ? 'Add photos or files' : 'More actions'}
                  />
                  <PromptInputActionMenuContent>
                    {takesFiles && <PromptInputActionAddAttachments label="Add photos or files" />}
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
                  defaultProvider={defaultProvider}
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
                      options={thinkingEffortOptions(
                        selectedModel.provider,
                        selectedModel.id,
                        selectedModel.kiro
                      )}
                    />
                  )}
              </PromptInputTools>
              <PromptInputTools className="ml-auto gap-1">
                {agentOption && (
                  <SessionAgentPicker
                    option={agentOption}
                    onChange={(value) => pickSessionOption(agentOption.id, value)}
                    disabled={isLoading}
                    onOpen={refreshSessionLists}
                  />
                )}
                {otherOptions.length > 0 && (
                  <SessionOptionsMenu
                    options={otherOptions}
                    onChange={pickSessionOption}
                    disabled={isLoading}
                  />
                )}
                {webSearch?.available && !isKiro && (
                  <WebSearchToggle
                    enabled={webSearch.on}
                    onToggle={() => onToggleWebSearch?.()}
                    disabled={isLoading}
                    toolsSupported={toolsSupported}
                    providerLabel={webSearchProviderLabel}
                  />
                )}
                {!isKiro && (
                  <>
                    <MCPToolsIndicator disabled={isLoading} toolsSupported={toolsSupported} />
                    <InferenceSettings
                      maxTokens={maxTokens}
                      setMaxTokens={setMaxTokens}
                      maxToolSteps={maxToolSteps}
                      setMaxToolSteps={setMaxToolSteps}
                      disabled={isLoading}
                    />
                  </>
                )}
                {showContext && !isKiro && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
                {showContext && (
                  <ContextIndicator
                    usage={chatUsage}
                    maxTokens={contextLimits?.contextWindow}
                    kiro={isKiro}
                    noModel={!selectedModel}
                  />
                )}
                <PromptInputSubmitWithAttachments
                  inputValue={inputValue}
                  selectedModel={selectedModel}
                  blocked={blockedFiles.length > 0}
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

/** Object URLs whose file left the screen, revoked after one tick unless it mounts again */
const pendingRevokes = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * One object URL for the stored bytes of an image, made once for the file and revoked when the
 * file leaves the screen (or its bytes change). No URL for any other file. The revoke waits one
 * tick, so the effect's remount in StrictMode keeps the URL that the thumbnail already shows.
 */
function useImageUrl(data: string | undefined, mediaType: string): string | undefined {
  const isImage = mediaType.startsWith('image/');
  const url = useMemo(
    () =>
      data && isImage
        ? URL.createObjectURL(new Blob([base64ToBytes(data)], { type: mediaType }))
        : undefined,
    [data, mediaType, isImage]
  );
  useEffect(() => {
    if (!url) return;
    clearTimeout(pendingRevokes.get(url));
    pendingRevokes.delete(url);
    return () => {
      pendingRevokes.set(
        url,
        setTimeout(() => {
          pendingRevokes.delete(url);
          URL.revokeObjectURL(url);
        }, 0)
      );
    };
  }, [url]);
  return url;
}

/** One file of a user message; memoized, so a streamed token does not touch its bytes */
const MessageFile = memo(function MessageFile({
  filename,
  mediaType,
  data,
  size,
}: {
  filename: string;
  mediaType: string;
  data: string | undefined;
  size: number | undefined;
}) {
  const url = useImageUrl(data, mediaType);
  const isImage = mediaType.startsWith('image/');
  return (
    <MessageAttachment
      data={{ type: 'file', filename, mediaType, url: url ?? '' }}
      size={size}
      notKept={!data}
      onOpen={isImage && url ? () => window.open(url, '_blank', 'noopener,noreferrer') : undefined}
    />
  );
});

/**
 * The files of a user message, above its text (D-D): an image thumbnail that opens full size in
 * a new tab, else a chip with the name, the type, and the size. A file without bytes says
 * "File not kept". An image's thumbnail and its tab share one object URL.
 */
const MessageFiles = ({ files }: { files: FilePart[] }) => (
  <MessageAttachments aria-label="Attached files" role="list">
    {files.map((file, i) => (
      <div key={`${file.filename ?? 'file'}-${i}`} role="listitem">
        <MessageFile
          filename={file.filename || 'file'}
          mediaType={file.mediaType || 'application/octet-stream'}
          data={file.kept === false ? undefined : file.data || undefined}
          size={file.size}
        />
      </div>
    ))}
  </MessageAttachments>
);

/** Under a reply: the earlier files that the request carried as a text line only (D-E) */
const FilesNotResentNote = ({ count }: { count: number }) => (
  <p className="text-xs text-muted-foreground">
    {count === 1
      ? '1 earlier file was not sent again'
      : `${count} earlier files were not sent again`}
  </p>
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

/** Credits and time of one Kiro reply. Kiro reports credits, not tokens or a price. */
const KiroReplyUsage = ({ usage, model }: { usage: MessageUsage; model?: string }) => {
  const details = [
    model ?? '',
    usage.credits !== undefined ? `Credits: ${Number(usage.credits.toFixed(4))}` : 'No credit data',
    usage.contextPercent !== undefined ? `Context: ${usage.contextPercent}%` : '',
  ].filter(Boolean);
  const parts = [
    usage.credits !== undefined ? formatCredits(usage.credits) : undefined,
    usage.latencyMs !== undefined ? formatLatency(usage.latencyMs) : undefined,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="ml-2 text-xs tabular-nums text-muted-foreground" title={details.join(' · ')}>
      {parts.join(' · ')}
    </p>
  );
};

/**
 * Reports the composer files that the selected model cannot read, each time the files or the
 * model change: a removed file or a switch back clears the block (D-B)
 */
const BlockedFilesWatch = ({
  model,
  onChange,
}: {
  model: UnifiedModel | null;
  onChange: (names: string[]) => void;
}) => {
  const { files } = usePromptInputAttachments();
  const names = unreadableFiles(model, files).join('\u0000');
  useEffect(() => {
    onChange(names ? names.split('\u0000') : []);
  }, [names, onChange]);
  return null;
};

// Submit button that checks both text input and attachments
const PromptInputSubmitWithAttachments = ({
  inputValue,
  selectedModel,
  blocked,
  isLoading,
  stopGeneration,
}: {
  inputValue: string;
  selectedModel: UnifiedModel | null;
  /** Files that the model cannot read are in the composer */
  blocked: boolean;
  isLoading: boolean;
  stopGeneration: () => void;
}) => {
  const attachments = usePromptInputAttachments();
  const hasContent = inputValue.trim().length > 0 || attachments.files.length > 0;

  // When streaming, the stop button should always be enabled
  // When not streaming, require content and a selected model
  const isDisabled = isLoading ? false : !hasContent || !selectedModel || blocked;

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

// Loading indicator shown during AI response generation, with the provider's progress text
// (for example "Starting Kiro…") when it sends one
const GeneratingIndicator = ({ status }: { status?: string | null }) => (
  <div className="flex items-center gap-2 py-2">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{status || 'Generating response...'}</span>
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
