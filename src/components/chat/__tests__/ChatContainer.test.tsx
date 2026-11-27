import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import ChatContainer from '../ChatContainer';

const chatMessages = vi.hoisted(() => ({ current: [] as unknown[] }));
const chatOptions = vi.hoisted(() => ({ current: {} as { enableWebSearch?: boolean } }));

vi.mock('../../../hooks/useBedrockChat', () => ({
  useBedrockChat: (options: { enableWebSearch?: boolean }) => {
    chatOptions.current = options;
    return {
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
    };
  },
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

  it('shows three lines in an empty chat and two lines at the bottom', () => {
    const model = {
      id: 'llama3.2',
      name: 'llama3.2',
      provider: 'ollama' as const,
      providerName: 'Ollama',
    };
    const { unmount } = renderChat({ selectedModel: model });
    const empty = screen.getByRole('textbox', { name: 'Message' });
    expect(empty.className).toContain('min-h-[calc(3lh+1.5rem)]');
    expect(empty.className).not.toContain('min-h-[calc(2lh+1.5rem)]');
    expect(empty.className).toContain('max-h-[min(40vh,20rem)]');
    expect(empty.className).toContain('pt-4');
    expect(empty.className).toContain('pb-2');
    unmount();

    chatMessages.current = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    renderChat({ selectedModel: model });
    const bottom = screen.getByRole('textbox', { name: 'Message' });
    expect(bottom.className).toContain('min-h-[calc(2lh+1.5rem)]');
    expect(bottom.className).not.toContain('min-h-[calc(3lh+1.5rem)]');
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

  it('shows the usage of a saved chat when no model is selected', async () => {
    const user = userEvent.setup();
    chatMessages.current = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello' }],
        model: { provider: 'ollama', id: 'qwen3:8b' },
        usage: { inputTokens: 900, outputTokens: 100 },
      },
    ];
    renderChat();
    await user.click(screen.getByRole('button', { name: 'Usage of this chat' }));
    expect(await screen.findByText('900')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Select a model to see the context use.')).toBeInTheDocument();
  });

  it('shows no usage chip before the first reply', () => {
    chatMessages.current = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    renderChat();
    expect(screen.queryByRole('button', { name: 'Usage of this chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Context used/ })).not.toBeInTheDocument();
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

  describe('web search', () => {
    const ollamaModel = {
      id: 'qwen3:8b',
      name: 'qwen3:8b',
      provider: 'ollama' as const,
      providerName: 'Ollama',
    };
    const on = { available: true, on: true, send: true };

    it('shows no globe button without a key, and sends no search', () => {
      renderChat({ selectedModel: ollamaModel });
      expect(screen.queryByRole('button', { name: 'Web search' })).not.toBeInTheDocument();
      expect(chatOptions.current.enableWebSearch).toBe(false);
    });

    it('shows the Search chip when on, sends search, and toggles through the callback', () => {
      const onToggleWebSearch = vi.fn();
      renderChat({ selectedModel: ollamaModel, webSearch: on, onToggleWebSearch });
      const globe = screen.getByRole('button', { name: 'Web search' });
      expect(globe).toHaveTextContent('Search');
      expect(globe).toHaveAttribute('aria-pressed', 'true');
      expect(chatOptions.current.enableWebSearch).toBe(true);
      fireEvent.click(globe);
      expect(onToggleWebSearch).toHaveBeenCalledTimes(1);
    });

    it('greys the globe and MCP buttons for a model that cannot use tools', () => {
      const onToggleWebSearch = vi.fn();
      renderChat({
        selectedModel: { ...ollamaModel, id: 'gemma3:4b', name: 'gemma3:4b', supportsTools: false },
        webSearch: { available: true, on: true, send: false },
        onToggleWebSearch,
      });
      const globe = screen.getByRole('button', { name: 'Web search' });
      expect(globe).toHaveAttribute('aria-disabled', 'true');
      expect(globe).not.toHaveTextContent('Search');
      fireEvent.click(globe);
      expect(onToggleWebSearch).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'MCP tools' })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      expect(chatOptions.current.enableWebSearch).toBe(false);
    });
  });
});

describe('ChatContainer attached files (#101)', () => {
  const PNG = 'iVBORw0KGgo=';
  const userWith = (parts: unknown[]) => [
    { id: 'u1', role: 'user', parts: [...parts, { type: 'text', text: 'what are these' }] },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stubObjectUrls = () => {
    let n = 0;
    const createObjectURL = vi.fn(() => `blob:file-${++n}`);
    const revokeObjectURL = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    onTestFinished(() => {
      Object.assign(URL, original);
    });
    return { createObjectURL, revokeObjectURL };
  };

  it('shows an image as a thumbnail with the file name as its alt text, and opens it', async () => {
    const user = userEvent.setup();
    const { createObjectURL, revokeObjectURL } = stubObjectUrls();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    chatMessages.current = userWith([
      { type: 'file', filename: 'photo.png', mediaType: 'image/png', data: PNG, size: 8 },
    ]);
    const { unmount } = renderChat();

    const img = screen.getByRole('img', { name: 'photo.png' });
    expect(img).toHaveAttribute('src', 'blob:file-1');
    // The files come before the text of the message
    const list = screen.getByRole('list', { name: 'Attached files' });
    const text = screen.getByText('what are these');
    expect(list.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Open photo.png' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith('blob:file-1', '_blank', 'noopener,noreferrer');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    unmount();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:file-1'));
  });

  it('makes one object URL per image, reused by the thumbnail, every click, and every render', async () => {
    const user = userEvent.setup();
    const { createObjectURL, revokeObjectURL } = stubObjectUrls();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const files = [
      { type: 'file', filename: 'photo.png', mediaType: 'image/png', data: PNG, size: 8 },
      {
        type: 'file',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        data: 'JVBERi0=',
        size: 2048,
      },
    ];
    chatMessages.current = userWith(files);
    const { rerender, unmount } = renderChat();

    // A streamed token renders the transcript again, with new message objects
    chatMessages.current = [
      ...userWith(files.map((f) => ({ ...f }))),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'one' }] },
    ];
    rerender(
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
        />
      </QueryClientProvider>
    );
    const button = screen.getByRole('button', { name: 'Open photo.png' });
    await user.click(button);
    await user.click(button);

    // The PDF gets no URL at all; the image gets one, made once
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(open.mock.calls.map((call) => call[0])).toEqual(['blob:file-1', 'blob:file-1']);
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'blob:file-1');
    expect(document.querySelector('img[src^="data:"]')).toBeNull();
    unmount();
    await waitFor(() => expect(revokeObjectURL.mock.calls).toEqual([['blob:file-1']]));
  });

  it('shows a PDF with its name, its type, and its size in text', () => {
    chatMessages.current = userWith([
      {
        type: 'file',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        data: 'JVBERi0=',
        size: 2048,
      },
    ]);
    renderChat();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF · 2 KB')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says "File not kept" for a file whose bytes are missing, also for an image', () => {
    chatMessages.current = userWith([
      { type: 'file', filename: 'lost.png', mediaType: 'image/png', size: 9, kept: false },
    ]);
    renderChat();
    expect(screen.getByText('lost.png')).toBeInTheDocument();
    expect(screen.getByText('File not kept')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument();
  });

  it('says under a reply how many earlier files were not sent again', () => {
    chatMessages.current = [
      ...userWith([]),
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'answer' }],
        filesNotResent: 2,
      },
    ];
    renderChat();
    expect(screen.getByText('2 earlier files were not sent again')).toBeInTheDocument();
  });
});
