import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatContainer from '../../chat/ChatContainer';
import { MessageAttachment } from '../message';
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputTextarea,
} from '../prompt-input';

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
    retryLast: vi.fn(),
    forkAndSend: vi.fn(),
    stopGeneration: vi.fn(),
    clearMessages: vi.fn(),
    resetUsage: vi.fn(),
  }),
}));

const MB = 1024 * 1024;
const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const pick = (files: File[]) => {
  const input = screen.getByLabelText('Upload files');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

const renderInput = (onError = vi.fn()) => {
  render(
    <PromptInput
      onSubmit={vi.fn()}
      onError={onError}
      accept="image/*,.pdf"
      multiple
      maxFileSize={4.5 * MB}
    >
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>
      <PromptInputTextarea />
    </PromptInput>
  );
  return onError;
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

describe('PromptInput file checks', () => {
  it('names skipped files in a mixed batch and keeps the valid one', () => {
    const onError = renderInput();
    pick([
      file('ok.pdf', 'application/pdf'),
      file('big.pdf', 'application/pdf', 5 * MB),
      file('report.zip', 'application/zip'),
    ]);
    expect(screen.getByText('ok.pdf')).toBeInTheDocument();
    expect(screen.queryByText('big.pdf')).toBeNull();
    expect(screen.queryByText('report.zip')).toBeNull();
    expect(onError).toHaveBeenCalledWith({
      code: 'accept',
      message: 'report.zip is not a supported file type. big.pdf is over 4.5 MB and was not added.',
    });
  });

  it('reports when every file has the wrong type', () => {
    const onError = renderInput();
    pick([file('a.zip', 'application/zip'), file('b.exe', 'application/octet-stream')]);
    expect(onError).toHaveBeenCalledWith({
      code: 'accept',
      message: 'a.zip, b.exe are not supported file types.',
    });
    expect(screen.queryByRole('button', { name: 'Remove attachment' })).toBeNull();
  });

  it('reports when every file is too large', () => {
    const onError = renderInput();
    pick([file('big.pdf', 'application/pdf', 5 * MB)]);
    expect(onError).toHaveBeenCalledWith({
      code: 'max_file_size',
      message: 'big.pdf is over 4.5 MB and was not added.',
    });
    expect(screen.queryByRole('button', { name: 'Remove attachment' })).toBeNull();
  });

  it('does not report when every file is accepted', () => {
    const onError = renderInput();
    pick([file('ok.pdf', 'application/pdf')]);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('drops outside the composer', () => {
  it('stops the browser from opening a file dropped elsewhere, without attaching it', () => {
    renderInput();
    const dataTransfer = { types: ['Files'], files: [file('ok.pdf', 'application/pdf')] };
    const drop = createEvent.drop(document.body, { dataTransfer });
    fireEvent(document.body, drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(screen.queryByText('ok.pdf')).toBeNull();
  });
});

describe('remove attachment buttons', () => {
  it('composer chip button shows on keyboard focus and touch, and the thumbnail hides', () => {
    renderInput();
    pick([file('ok.pdf', 'application/pdf')]);
    const button = screen.getByRole('button', { name: 'Remove attachment' });
    expect(button).toHaveClass('focus-visible:opacity-100', 'pointer-coarse:opacity-100');
    expect(button.previousElementSibling).toHaveClass('group-focus-within:opacity-0');
  });

  it('message attachment buttons show on keyboard focus and touch', () => {
    const { rerender } = render(
      <MessageAttachment
        data={{ type: 'file', mediaType: 'image/png', url: 'blob:x', filename: 'a.png' }}
        onRemove={vi.fn()}
      />
    );
    const check = () =>
      expect(screen.getByRole('button', { name: 'Remove attachment' })).toHaveClass(
        'focus-visible:opacity-100',
        'pointer-coarse:opacity-100'
      );
    check();
    rerender(
      <MessageAttachment
        data={{ type: 'file', mediaType: 'application/pdf', url: 'blob:x', filename: 'a.pdf' }}
        onRemove={vi.fn()}
      />
    );
    check();
  });
});

describe('ChatContainer file error', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a newer error for its full 5 seconds', () => {
    vi.useFakeTimers();
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
        />
      </QueryClientProvider>
    );
    pick([file('first.zip', 'application/zip')]);
    act(() => vi.advanceTimersByTime(3000));
    pick([file('second.zip', 'application/zip')]);
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByText('second.zip is not a supported file type.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.queryByText('second.zip is not a supported file type.')).toBeNull();
  });
});
