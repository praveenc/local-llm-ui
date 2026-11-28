import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UnifiedModel } from '../../../hooks/useAllModels';
import ChatContainer from '../ChatContainer';

const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  messages: [] as unknown[],
  status: 'idle' as string,
  streamStatus: null as string | null,
}));

vi.mock('../../../hooks/useBedrockChat', () => ({
  useBedrockChat: () => ({
    messages: chat.messages,
    status: chat.status,
    error: null,
    wasInterrupted: false,
    streamStatus: chat.streamStatus,
    sendMessage: chat.sendMessage,
    regenerate: vi.fn(),
    retryLast: vi.fn(),
    forkAndSend: vi.fn(),
    rateMessage: vi.fn(),
    stopGeneration: vi.fn(),
    clearMessages: vi.fn(),
  }),
}));

const kiroModel: UnifiedModel = {
  id: 'claude-opus-5.5',
  name: 'Claude Opus 5.5',
  provider: 'kiro',
  providerName: 'Kiro',
  supportsThinking: true,
  kiro: { effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], rateMultiplier: 2 },
};

const bedrockModel: UnifiedModel = {
  id: 'global.anthropic.claude-haiku-5-5',
  name: 'Global Anthropic Claude Haiku 5.5',
  provider: 'bedrock',
  providerName: 'Amazon Bedrock',
};

const text = (t: string) => [{ type: 'text', text: t }];

const chatElement = (selectedModel: UnifiedModel, client = new QueryClient()) => (
  <QueryClientProvider client={client}>
    <ChatContainer
      providers={[]}
      selectedModel={selectedModel}
      onSelectModel={vi.fn()}
      maxTokens={4096}
      setMaxTokens={vi.fn()}
      maxToolSteps={10}
      setMaxToolSteps={vi.fn()}
      thinkingEffort="default"
      setThinkingEffort={vi.fn()}
      webSearch={{ available: true, on: true, send: true }}
      onToggleWebSearch={vi.fn()}
    />
  </QueryClientProvider>
);

const renderChat = (selectedModel: UnifiedModel) => render(chatElement(selectedModel));

afterEach(() => {
  chat.sendMessage.mockReset();
  chat.messages = [];
  chat.status = 'idle';
  chat.streamStatus = null;
});

describe('ChatContainer with Kiro', () => {
  it('hides web search, MCP tools, inference settings, and files for a Kiro model', async () => {
    const user = userEvent.setup();
    renderChat(kiroModel);
    expect(screen.queryByRole('button', { name: 'Web search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MCP tools/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inference settings' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Save as prompt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Add photos or files/ })).not.toBeInTheDocument();
  });

  it('shows the four controls for a Bedrock model', async () => {
    const user = userEvent.setup();
    renderChat(bedrockModel);
    expect(screen.getByRole('button', { name: 'Web search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MCP tools/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inference settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add photos or files' }));
    expect(
      await screen.findByRole('menuitem', { name: /Add photos or files/ })
    ).toBeInTheDocument();
  });

  it('offers Max in the Thinking menu of a Kiro model that has it', async () => {
    const user = userEvent.setup();
    renderChat(kiroModel);
    await user.click(screen.getByRole('button', { name: /Thinking/ }));
    expect(await screen.findByRole('menuitemradio', { name: 'Max' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Minimal' })).not.toBeInTheDocument();
  });

  it('hides Regenerate on a Kiro reply and shows credits and time under it', () => {
    chat.messages = [
      { id: 'u1', role: 'user', parts: text('hi') },
      {
        id: 'a1',
        role: 'assistant',
        parts: text('Hello'),
        model: { provider: 'kiro', id: 'claude-opus-5.5', name: 'Claude Opus 5.5' },
        usage: { credits: 0.05, contextPercent: 3, latencyMs: 2900 },
      },
      { id: 'u2', role: 'user', parts: text('and now') },
      {
        id: 'a2',
        role: 'assistant',
        parts: text('Bedrock answer'),
        model: { provider: 'bedrock', id: bedrockModel.id, name: bedrockModel.name },
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    ];
    renderChat(kiroModel);

    // One Regenerate: on the Bedrock reply only. Copy and the ratings stay on both.
    expect(screen.getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Helpful' })).toHaveLength(2);

    const usage = screen.getByText('0.05 credits · 2.9 s');
    expect(usage).toHaveAttribute('title', expect.stringContaining('Credits: 0.05'));
    expect(usage.textContent).not.toMatch(/\$|in ·|out/);
  });

  it("shows Kiro's context percent in the ring and the chat's credits in the popover", async () => {
    const user = userEvent.setup();
    chat.messages = [
      { id: 'u1', role: 'user', parts: text('hi') },
      {
        id: 'a1',
        role: 'assistant',
        parts: text('one'),
        model: { provider: 'kiro', id: 'claude-opus-5.5' },
        usage: { credits: 0.05, contextPercent: 30 },
      },
      { id: 'u2', role: 'user', parts: text('more') },
      {
        id: 'a2',
        role: 'assistant',
        parts: text('two'),
        model: { provider: 'kiro', id: 'claude-opus-5.5' },
        usage: { credits: 0.2, contextPercent: 72 },
      },
    ];
    renderChat(kiroModel);

    const ring = screen.getByRole('button', { name: 'Context used: 72%, near the limit' });
    await user.click(ring);
    expect(await screen.findByText('72% of the context window')).toBeInTheDocument();
    expect(screen.getByText('0.25 credits')).toBeInTheDocument();
    expect(screen.queryByText('No price data')).not.toBeInTheDocument();
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
  });

  describe('the totals of a saved chat with Kiro and Bedrock replies', () => {
    const saved = () => [
      { id: 'u1', role: 'user', parts: text('hi') },
      {
        id: 'a1',
        role: 'assistant',
        parts: text('one'),
        model: { provider: 'bedrock', id: bedrockModel.id, name: bedrockModel.name },
        usage: { inputTokens: 1200, outputTokens: 300 },
      },
      { id: 'u2', role: 'user', parts: text('more') },
      {
        id: 'a2',
        role: 'assistant',
        parts: text('two'),
        model: { provider: 'kiro', id: 'claude-opus-5.5' },
        usage: { credits: 0.25, contextPercent: 40 },
      },
    ];

    it('shows the ring and both totals when the current model did not reply last', async () => {
      const user = userEvent.setup();
      chat.messages = saved();
      renderChat(bedrockModel);
      // Bedrock did not reply last: no fill, but the totals of the whole chat
      expect(screen.queryByRole('button', { name: /Context used/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Usage of this chat' }));
      const popover = within(await screen.findByRole('dialog'));
      expect(
        popover.getByText('Context use shows after the next reply from this model.')
      ).toBeInTheDocument();
      expect(popover.getByText('1.2K')).toBeInTheDocument();
      expect(popover.getByText('300')).toBeInTheDocument();
      expect(popover.getByText('Cost')).toBeInTheDocument();
      expect(popover.getByText('Credits in this chat')).toBeInTheDocument();
      expect(popover.getByText('0.25 credits')).toBeInTheDocument();
    });

    it('shows the sum of the cost of every Bedrock reply', async () => {
      const user = userEvent.setup();
      const bedrock = { provider: 'bedrock', id: bedrockModel.id, name: bedrockModel.name };
      chat.messages = [
        ...saved(),
        { id: 'u3', role: 'user', parts: text('again') },
        {
          id: 'a3',
          role: 'assistant',
          parts: text('three'),
          model: bedrock,
          usage: { inputTokens: 2000, outputTokens: 400 },
        },
      ];
      renderChat(kiroModel);
      await user.click(screen.getByRole('button', { name: 'Usage of this chat' }));
      const popover = within(await screen.findByRole('dialog'));
      // Haiku 5.5 at $0.1 / $0.5 per M: $0.00027 + $0.0004. The last reply alone is $0.0004.
      expect(popover.getByText('$0.0007')).toBeInTheDocument();
      expect(popover.queryByText('$0.0004')).not.toBeInTheDocument();
    });

    it('fills the ring for the Kiro model that replied last, with both totals', async () => {
      const user = userEvent.setup();
      chat.messages = saved();
      renderChat(kiroModel);
      await user.click(screen.getByRole('button', { name: 'Context used: 40%' }));
      const popover = within(await screen.findByRole('dialog'));
      expect(popover.getByText('40% of the context window')).toBeInTheDocument();
      expect(popover.getByText('1.2K')).toBeInTheDocument();
      expect(popover.getByText('Cost')).toBeInTheDocument();
      expect(popover.getByText('0.25 credits')).toBeInTheDocument();
    });
  });

  it('rounds the credits in the tooltip', () => {
    chat.messages = [
      { id: 'u1', role: 'user', parts: text('hi') },
      {
        id: 'a1',
        role: 'assistant',
        parts: text('Hello'),
        model: { provider: 'kiro', id: 'claude-opus-5.5' },
        usage: { credits: 0.21 + 0.42 },
      },
    ];
    renderChat(kiroModel);
    const usage = screen.getByText('0.63 credits');
    expect(usage).toHaveAttribute('title', expect.stringContaining('Credits: 0.63'));
    expect(usage.getAttribute('title')).not.toContain('0.6300000000000001');
  });

  it('shows the status text while Kiro starts', () => {
    chat.messages = [{ id: 'u1', role: 'user', parts: text('hi') }];
    chat.status = 'streaming';
    chat.streamStatus = 'Starting Kiro…';
    renderChat(kiroModel);
    expect(screen.getByText('Starting Kiro…')).toBeInTheDocument();
  });

  it('blocks the send when files attached before a switch to Kiro are in the composer', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('data:text/plain;base64,eA==');
    const client = new QueryClient();
    const { rerender } = render(chatElement(bedrockModel, client));
    await user.upload(
      screen.getByLabelText('Upload files'),
      new File(['x'], 'a.txt', { type: 'text/plain' })
    );

    rerender(chatElement(kiroModel, client));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');

    expect(
      await screen.findByText(
        'This model cannot read a.txt. Remove it or pick a different model to send.'
      )
    ).toBeInTheDocument();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    createObjectURL.mockRestore();
  });

  it('says that Kiro takes no files when a file is dropped on a Kiro chat', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderChat(kiroModel);
    await user.upload(
      screen.getByLabelText('Upload files'),
      new File(['x'], 'a.txt', { type: 'text/plain' })
    );
    expect(
      screen.getByText('Kiro does not take files yet. Send the text without them.')
    ).toBeInTheDocument();
  });
});
