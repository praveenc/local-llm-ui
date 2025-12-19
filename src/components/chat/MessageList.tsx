import remarkGfm from 'remark-gfm';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

import Avatar from '@cloudscape-design/chat-components/avatar';
import ChatBubble from '@cloudscape-design/chat-components/chat-bubble';
import {
  Box,
  ButtonGroup,
  CopyToClipboard,
  ExpandableSection,
  SpaceBetween,
} from '@cloudscape-design/components';

import CodeBlock from './CodeBlock';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface MessageListProps {
  messages: Message[];
  streamingMessage?: Message | null;
  avatarInitials?: string;
  lastMessageMetadata?: UsageMetadata | null;
}

const MessageList = ({
  messages,
  streamingMessage,
  avatarInitials = 'PC',
  lastMessageMetadata,
}: MessageListProps) => {
  const [messageFeedback, setMessageFeedback] = useState<Record<number, string>>({});

  const parseThinkingContent = (content: string) => {
    const thinkRegex = /<think>(.*?)<\/think>/s;
    const match = content.match(thinkRegex);

    if (match) {
      const thinkingContent = match[1].trim();
      const mainContent = content.replace(thinkRegex, '').trim();
      return { thinkingContent, mainContent };
    }

    return { thinkingContent: null, mainContent: content };
  };

  const handleFeedback = (messageId: number, feedbackType: string) => {
    setMessageFeedback((prev) => ({
      ...prev,
      [messageId]: feedbackType,
    }));
  };

  // Reusable markdown components configuration with table support
  const markdownComponents = {
    code: ({
      className,
      children,
      ...props
    }: {
      className?: string;
      children?: React.ReactNode;
    }) => {
      const inline = !className;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : undefined;
      const codeString = String(children).replace(/\n$/, '');

      return !inline ? (
        <CodeBlock code={codeString} language={language} />
      ) : (
        <code
          style={{
            backgroundColor: 'var(--color-background-code-inline, #f4f4f4)',
            padding: '0.2em 0.4em',
            borderRadius: '3px',
            fontFamily: 'monospace',
            fontSize: '0.9em',
          }}
          {...props}
        >
          {children}
        </code>
      );
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div style={{ overflowX: 'auto', margin: '1em 0' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: '0.9em',
          }}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead
        style={{
          backgroundColor: 'var(--color-background-container-header, #fafafa)',
        }}
      >
        {children}
      </thead>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th
        style={{
          border: '1px solid var(--color-border-divider-default, #e9ebed)',
          padding: '8px 12px',
          textAlign: 'left',
          fontWeight: 600,
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td
        style={{
          border: '1px solid var(--color-border-divider-default, #e9ebed)',
          padding: '8px 12px',
        }}
      >
        {children}
      </td>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  };

  // Find the last assistant message index
  const lastAssistantIndex = messages.reduce(
    (lastIdx, msg, idx) => (msg.role === 'assistant' ? idx : lastIdx),
    -1
  );

  return (
    <SpaceBetween size="s">
      {messages.map((message, index) => (
        <SpaceBetween key={message.id} size="xs">
          <ChatBubble
            type={message.role === 'assistant' ? 'incoming' : 'outgoing'}
            ariaLabel={message.role === 'assistant' ? 'AI Assistant' : 'You'}
            actions={
              message.role === 'assistant' ? (
                <SpaceBetween direction="horizontal" size="xs">
                  <ButtonGroup
                    ariaLabel="Chat bubble actions"
                    variant="icon"
                    items={[
                      {
                        type: 'group',
                        text: 'Feedback',
                        items: [
                          {
                            type: 'icon-button',
                            id: `helpful-${message.id}`,
                            iconName:
                              messageFeedback[message.id] === 'helpful'
                                ? 'thumbs-up-filled'
                                : 'thumbs-up',
                            text: 'Helpful',
                            disabled: messageFeedback[message.id] === 'helpful',
                          },
                          {
                            type: 'icon-button',
                            id: `not-helpful-${message.id}`,
                            iconName:
                              messageFeedback[message.id] === 'not-helpful'
                                ? 'thumbs-down-filled'
                                : 'thumbs-down',
                            text: 'Not helpful',
                            disabled:
                              messageFeedback[message.id] === 'not-helpful' ||
                              messageFeedback[message.id] === 'helpful',
                          },
                        ],
                      },
                    ]}
                    onItemClick={(e) => {
                      if (e.detail.id.startsWith('helpful-')) {
                        handleFeedback(message.id, 'helpful');
                      } else if (e.detail.id.startsWith('not-helpful-')) {
                        handleFeedback(message.id, 'not-helpful');
                      }
                    }}
                  />
                  <CopyToClipboard
                    copyButtonAriaLabel="Copy message"
                    copyErrorText="Message failed to copy"
                    copySuccessText="Message copied"
                    textToCopy={message.content}
                    variant="icon"
                  />
                </SpaceBetween>
              ) : undefined
            }
            avatar={
              message.role === 'assistant' ? (
                <Avatar
                  color="gen-ai"
                  iconName="gen-ai"
                  ariaLabel="AI Assistant"
                  tooltipText="AI Assistant"
                />
              ) : (
                <Avatar
                  initials={avatarInitials}
                  ariaLabel={avatarInitials}
                  tooltipText={avatarInitials}
                />
              )
            }
          >
            {message.role === 'assistant' ? (
              (() => {
                const { thinkingContent, mainContent } = parseThinkingContent(message.content);
                return thinkingContent ? (
                  <SpaceBetween size="s">
                    <ExpandableSection headerText="Thinking Process">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {thinkingContent}
                      </ReactMarkdown>
                    </ExpandableSection>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {mainContent}
                    </ReactMarkdown>
                  </SpaceBetween>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {mainContent}
                  </ReactMarkdown>
                );
              })()
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ...markdownComponents,
                  p: ({ children }) => <>{children}</>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </ChatBubble>
          {/* Show usage metrics after the last assistant message */}
          {message.role === 'assistant' &&
            index === lastAssistantIndex &&
            lastMessageMetadata &&
            !streamingMessage && (
              <Box padding={{ left: 'xxxl' }}>
                <Box fontSize="body-s" color="text-body-secondary">
                  <SpaceBetween direction="horizontal" size="m">
                    {(lastMessageMetadata.inputTokens !== undefined ||
                      lastMessageMetadata.promptTokens !== undefined) && (
                      <span>
                        <Box variant="span" fontWeight="bold">
                          Input:
                        </Box>{' '}
                        <span style={{ fontStyle: 'italic' }}>
                          {(
                            lastMessageMetadata.inputTokens ?? lastMessageMetadata.promptTokens
                          )?.toLocaleString()}{' '}
                          tokens
                        </span>
                      </span>
                    )}
                    {(lastMessageMetadata.outputTokens !== undefined ||
                      lastMessageMetadata.completionTokens !== undefined) && (
                      <span>
                        <Box variant="span" fontWeight="bold">
                          Output:
                        </Box>{' '}
                        <span style={{ fontStyle: 'italic' }}>
                          {(
                            lastMessageMetadata.outputTokens ?? lastMessageMetadata.completionTokens
                          )?.toLocaleString()}{' '}
                          tokens
                        </span>
                      </span>
                    )}
                    {lastMessageMetadata.totalTokens !== undefined && (
                      <span>
                        <Box variant="span" fontWeight="bold">
                          Total:
                        </Box>{' '}
                        <span style={{ fontStyle: 'italic' }}>
                          {lastMessageMetadata.totalTokens.toLocaleString()} tokens
                        </span>
                      </span>
                    )}
                    {lastMessageMetadata.latencyMs !== undefined && (
                      <span>
                        <Box variant="span" fontWeight="bold">
                          Latency:
                        </Box>{' '}
                        <span style={{ fontStyle: 'italic' }}>
                          {lastMessageMetadata.latencyMs}ms
                        </span>
                      </span>
                    )}
                  </SpaceBetween>
                </Box>
              </Box>
            )}
        </SpaceBetween>
      ))}

      {streamingMessage && (
        <ChatBubble
          key={streamingMessage.id}
          type="incoming"
          ariaLabel="AI Assistant"
          avatar={
            <Avatar
              color="gen-ai"
              iconName="gen-ai"
              ariaLabel="AI Assistant"
              tooltipText="AI Assistant"
              loading={true}
            />
          }
        >
          {streamingMessage.content ? (
            <Box padding={{ top: 'xs', bottom: 'xs' }}>
              {(() => {
                const { thinkingContent, mainContent } = parseThinkingContent(
                  streamingMessage.content
                );
                return (
                  <SpaceBetween size="s">
                    {thinkingContent && (
                      <ExpandableSection headerText="Thinking Process">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {thinkingContent}
                        </ReactMarkdown>
                      </ExpandableSection>
                    )}
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {mainContent}
                    </ReactMarkdown>
                    <span className="cursor">|</span>
                  </SpaceBetween>
                );
              })()}
            </Box>
          ) : (
            <Box color="text-status-inactive">Generating response</Box>
          )}
        </ChatBubble>
      )}
    </SpaceBetween>
  );
};

export default MessageList;
