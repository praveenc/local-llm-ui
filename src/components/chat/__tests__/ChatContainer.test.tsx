import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChatContainer from '../ChatContainer';

vi.mock('../../../hooks/useBedrockChat', () => ({
  useBedrockChat: () => ({
    messages: [],
    status: 'ready',
    error: null,
    metadata: null,
    cumulativeUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    wasInterrupted: false,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    forkAndSend: vi.fn(),
    stopGeneration: vi.fn(),
    clearMessages: vi.fn(),
    resetUsage: vi.fn(),
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
});
