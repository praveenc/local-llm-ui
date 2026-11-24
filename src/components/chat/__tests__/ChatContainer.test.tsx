import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatContainer from '../ChatContainer';

const chatMessages = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../../../hooks/useBedrockChat', () => ({
  useBedrockChat: () => ({
    messages: chatMessages.current,
    status: 'ready',
    error: null,
    wasInterrupted: false,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    retryLast: vi.fn(),
    forkAndSend: vi.fn(),
    stopGeneration: vi.fn(),
    clearMessages: vi.fn(),
  }),
}));

const renderChat = (props: Partial<React.ComponentProps<typeof ChatContainer>> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatContainer
        providers={[]}
        selectedModel={null}
        onSelectModel={vi.fn()}
        maxTokens={4096}
        setMaxTokens={vi.fn()}
        maxToolSteps={10}
        setMaxToolSteps={vi.fn()}
        thinkingEffort="default"
        setThinkingEffort={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );

afterEach(() => {
  chatMessages.current = [];
});

describe('ChatContainer', () => {
  it('labels the message box', () => {
    renderChat();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('has a polite live region for reply status', () => {
    renderChat();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('focuses the message box on / when a model is selected', () => {
    renderChat({
      selectedModel: {
        id: 'llama3.2',
        name: 'llama3.2',
        provider: 'ollama',
        providerName: 'Ollama',
      },
    });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('puts the message box under a heading on an empty chat', () => {
    renderChat({
      selectedModel: {
        id: 'llama3.2',
        name: 'llama3.2',
        provider: 'ollama',
        providerName: 'Ollama',
      },
    });
    expect(screen.getByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    expect(screen.queryByText(/Send a message to start/)).not.toBeInTheDocument();
  });

  it('has no Clear chat or Save prompt button; Save as prompt is in the + menu', async () => {
    const user = userEvent.setup();
    renderChat({
      selectedModel: {
        id: 'llama3.2',
        name: 'llama3.2',
        provider: 'ollama',
        providerName: 'Ollama',
      },
    });
    expect(screen.queryByRole('button', { name: 'Clear chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save prompt' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add photos or files' }));
    expect(await screen.findByRole('menuitem', { name: 'Save as prompt' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('marks the turn where the model changes, and shows no sticky model badge', () => {
    const text = (t: string) => [{ type: 'text', text: t }];
    const haiku = {
      provider: 'bedrock',
      id: 'global.anthropic.claude-haiku-5-5',
      name: 'Global Anthropic Claude Haiku 5.5',
    };
    const sonnet = {
      provider: 'bedrock',
      id: 'us.anthropic.claude-sonnet-5-5',
      name: 'US Anthropic Claude Sonnet 5.5',
    };
    chatMessages.current = [
      { id: 'u1', role: 'user', parts: text('one') },
      { id: 'a1', role: 'assistant', parts: text('first'), model: haiku },
      { id: 'u2', role: 'user', parts: text('two') },
      { id: 'a2', role: 'assistant', parts: text('second'), model: haiku },
      { id: 'u3', role: 'user', parts: text('three') },
      { id: 'a3', role: 'assistant', parts: text('third'), model: sonnet },
    ];
    renderChat({
      selectedModel: { ...sonnet, provider: 'bedrock', providerName: 'Amazon Bedrock' },
    });
    const dividers = screen.getAllByRole('separator', { name: /Switched to/ });
    expect(dividers).toHaveLength(1);
    expect(dividers[0]).toHaveAccessibleName('Switched to Claude Sonnet 5.5 · US');
    expect(screen.queryByLabelText(/Active model/)).not.toBeInTheDocument();
  });
});
