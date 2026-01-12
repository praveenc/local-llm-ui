/**
 * BedrockChatContainer
 *
 * Chat container using AI Elements components and useBedrockChat hook.
 * This is the new UI for Bedrock chat with AI SDK integration.
 */

'use client';

import { Bot, Copy, RefreshCw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';

import { Fragment, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ModelOption } from '@/types';

import { useBedrockChat } from '../../hooks/useBedrockChat';
import { getReasoningContent, getTextContent, hasReasoning } from '../../types/ai-messages';
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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../ai-elements/prompt-input';
import { FittedContainer, ScrollableContainer } from '../layout';

/**
 * BedrockChatContainer
 *
 * Chat container using AI Elements components and useBedrockChat hook.
 * This is the new UI for Bedrock chat with AI SDK integration.
 */

type SamplingParameter = 'temperature' | 'topP';

interface BedrockChatContainerProps {
  selectedModel: ModelOption | null;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  samplingParameter: SamplingParameter;
  setSamplingParameter: (param: SamplingParameter) => void;
  avatarInitials?: string;
  conversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
}

// Helper to get provider info for display
const getProviderInfo = (model: ModelOption | null) => {
  const desc = model?.description?.toLowerCase() ?? '';
  if (desc.includes('bedrock-mantle'))
    return { icon: '/bedrock-color.svg', name: 'Bedrock Mantle' };
  if (desc.includes('bedrock')) return { icon: '/bedrock_bw.svg', name: 'Amazon Bedrock' };
  return null;
};

// Helper function to get file format from media type
function getFormatFromMediaType(mediaType: string): string {
  const typeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return typeMap[mediaType] || 'bin';
}

const BedrockChatContainer = ({
  selectedModel,
  maxTokens,
  temperature,
  topP,
  samplingParameter,
  conversationId: externalConversationId,
  onConversationChange,
}: BedrockChatContainerProps) => {
  const [inputValue, setInputValue] = useState('');
  const [messageFeedback, setMessageFeedback] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    status,
    error,
    metadata,
    sendMessage,
    regenerate,
    stopGeneration,
    clearMessages,
  } = useBedrockChat({
    conversationId: externalConversationId ?? null,
    selectedModel,
    temperature,
    topP,
    maxTokens,
    samplingParameter,
    onConversationChange,
  });

  const isLoading = status === 'streaming' || status === 'submitted';
  const providerInfo = getProviderInfo(selectedModel);

  const handleSubmit = async (message: {
    text: string;
    files: Array<{ url?: string; mediaType?: string; filename?: string }>;
  }) => {
    if (!message.text.trim() || isLoading) return;
    setInputValue('');

    if (message.files.length > 0) {
      const filesWithData = await Promise.all(
        message.files.map(async (f) => {
          if (f.url?.startsWith('data:')) {
            const base64 = f.url.split(',')[1] || '';
            return {
              name: f.filename || 'file',
              format: getFormatFromMediaType(f.mediaType || ''),
              bytes: base64,
            };
          }
          return null;
        })
      );
      const validFiles = filesWithData.filter(
        (f): f is { name: string; format: string; bytes: string } => f !== null
      );
      await sendMessage(message.text, validFiles);
    } else {
      await sendMessage(message.text);
    }
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

  const lastAssistantIndex = messages.reduce(
    (lastIdx, msg, idx) => (msg.role === 'assistant' ? idx : lastIdx),
    -1
  );

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="relative flex flex-col h-full">
        <FittedContainer>
          <ScrollableContainer ref={scrollContainerRef}>
            <div className="p-4 pb-44">
              {messages.length === 0 ? (
                <EmptyState selectedModel={selectedModel} providerInfo={providerInfo} />
              ) : (
                <Conversation className="max-w-4xl mx-auto">
                  <ConversationContent>
                    {messages.map((message, index) => (
                      <Fragment key={message.id}>
                        <Message from={message.role}>
                          <MessageContent>
                            {hasReasoning(message) && (
                              <ReasoningBlock content={getReasoningContent(message) || ''} />
                            )}
                            <MessageResponse>{getTextContent(message)}</MessageResponse>
                          </MessageContent>
                        </Message>
                        {message.role === 'assistant' && (
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
                      </Fragment>
                    ))}
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
              )}
            </div>
          </ScrollableContainer>
        </FittedContainer>
        <div className="absolute bottom-0 left-0 right-0 z-[1000] p-2 md:p-4">
          <PromptInput
            onSubmit={handleSubmit}
            accept="image/*,.pdf,.txt,.html,.md,.csv,.doc,.docx,.xls,.xlsx"
            multiple
            maxFileSize={4.5 * 1024 * 1024}
            className="max-w-4xl mx-auto bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-lg"
          >
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              value={inputValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setInputValue(e.target.value)
              }
              placeholder={
                selectedModel ? 'What would you like to know?' : 'Select a model to start chatting'
              }
              disabled={isLoading || !selectedModel}
            />
            <PromptInputFooter className="px-3 pb-3">
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="Add photos or files" />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                {selectedModel && providerInfo && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-muted-foreground">
                    <img
                      src={providerInfo.icon}
                      alt={providerInfo.name}
                      className="w-4 h-4 shrink-0"
                    />
                    <span className="text-xs truncate max-w-[150px]">{selectedModel.label}</span>
                  </div>
                )}
                {messages.length > 0 && (
                  <PromptInputButton
                    onClick={clearMessages}
                    disabled={isLoading}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </PromptInputButton>
                )}
              </PromptInputTools>
              <PromptInputSubmit
                status={isLoading ? 'streaming' : 'ready'}
                disabled={!inputValue.trim() || !selectedModel}
                onClick={isLoading ? stopGeneration : undefined}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
};

const EmptyState = ({
  selectedModel,
  providerInfo,
}: {
  selectedModel: ModelOption | null;
  providerInfo: { icon: string; name: string } | null;
}) => (
  <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
    {selectedModel ? (
      <>
        {providerInfo && (
          <img src={providerInfo.icon} alt={providerInfo.name} className="w-16 h-16 opacity-50" />
        )}
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">Ready to chat</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Send a message to start chatting with <strong>{selectedModel.label}</strong>
          </p>
        </div>
      </>
    ) : (
      <>
        <Bot className="h-16 w-16 text-muted-foreground/50" />
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">No model selected</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Select a model from the sidebar to begin
          </p>
        </div>
      </>
    )}
  </div>
);

const ReasoningBlock = ({ content }: { content: string }) => (
  <details className="mb-3 rounded-lg bg-muted/50 p-3">
    <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
      Thinking Process
    </summary>
    <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{content}</div>
  </details>
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

export default BedrockChatContainer;
