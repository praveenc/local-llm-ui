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

interface MessageListProps {
  messages: Message[];
  streamingMessage?: Message | null;
  avatarInitials?: string;
}

const MessageList = ({ messages, streamingMessage, avatarInitials = 'PC' }: MessageListProps) => {
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

  return (
    <SpaceBetween size="s">
      {messages.map((message) => (
        <ChatBubble
          key={message.id}
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
                    <ReactMarkdown
                      components={{
                        code: ({ className, children, ...props }) => {
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
                      }}
                    >
                      {thinkingContent}
                    </ReactMarkdown>
                  </ExpandableSection>
                  <ReactMarkdown
                    components={{
                      code: ({ className, children, ...props }) => {
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
                    }}
                  >
                    {mainContent}
                  </ReactMarkdown>
                </SpaceBetween>
              ) : (
                <ReactMarkdown
                  components={{
                    code: ({ className, children, ...props }) => {
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
                  }}
                >
                  {mainContent}
                </ReactMarkdown>
              );
            })()
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <>{children}</>,
                code: ({ className, children, ...props }) => {
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
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </ChatBubble>
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
          <Box padding={{ top: 'xs', bottom: 'xs' }}>
            {(() => {
              const { thinkingContent, mainContent } = parseThinkingContent(
                streamingMessage.content
              );
              return (
                <SpaceBetween size="s">
                  {thinkingContent && (
                    <ExpandableSection headerText="Thinking Process">
                      <ReactMarkdown
                        components={{
                          code: ({ className, children, ...props }) => {
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
                        }}
                      >
                        {thinkingContent}
                      </ReactMarkdown>
                    </ExpandableSection>
                  )}
                  <ReactMarkdown
                    components={{
                      pre: ({ ...props }) => (
                        <div className="code-block-container">
                          <pre {...props} />
                        </div>
                      ),
                      code: ({ ...props }) =>
                        !props.className ? (
                          <code className="inline-code" {...props} />
                        ) : (
                          <code className="code-block" {...props} />
                        ),
                    }}
                  >
                    {mainContent}
                  </ReactMarkdown>
                  <span className="cursor">|</span>
                </SpaceBetween>
              );
            })()}
          </Box>
        </ChatBubble>
      )}
    </SpaceBetween>
  );
};

export default MessageList;
