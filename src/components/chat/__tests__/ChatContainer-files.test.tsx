import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UnifiedModel } from '../../../hooks/useAllModels';
import ChatContainer from '../ChatContainer';

const chat = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../../hooks/useBedrockChat', () => ({
  useBedrockChat: () => ({
    messages: [],
    status: 'idle',
    error: null,
    wasInterrupted: false,
    streamStatus: null,
    sendMessage: chat.sendMessage,
    regenerate: vi.fn(),
    retryLast: vi.fn(),
    forkAndSend: vi.fn(),
    rateMessage: vi.fn(),
    stopGeneration: vi.fn(),
    clearMessages: vi.fn(),
  }),
}));

const model = (provider: UnifiedModel['provider'], extra: Partial<UnifiedModel> = {}) =>
  ({
    id: `${provider}-model`,
    name: `${provider} model`,
    provider,
    providerName: provider,
    ...extra,
  }) as UnifiedModel;
const bedrock = model('bedrock');
const groq = model('groq');
const mantle = model('bedrock-mantle');

const chatElement = (selectedModel: UnifiedModel, client: QueryClient) => (
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
    />
  </QueryClientProvider>
);

const file = (name: string, type: string, size = 1) => {
  const f = new File(['x'], name, { type });
  if (size !== 1) Object.defineProperty(f, 'size', { value: size });
  return f;
};
const upload = () => screen.getByLabelText('Upload files');
const fileError = () => screen.queryByRole('alert');

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
  // jsdom has no object URLs; a data URL also skips the blob read on send
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('data:text/plain;base64,eA==');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => {
  chat.sendMessage.mockReset();
  vi.restoreAllMocks();
});

describe('ChatContainer files', () => {
  it('has no Add photos or files for a Mantle model', async () => {
    const user = userEvent.setup();
    render(chatElement(mantle, client));
    expect(screen.queryByRole('button', { name: 'Add photos or files' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Save as prompt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Add photos or files/ })).not.toBeInTheDocument();
  });

  it('shows only the types that the model reads in the file dialog', () => {
    render(chatElement(groq, client));
    const accept = upload().getAttribute('accept') ?? '';
    expect(accept).toContain('.md');
    expect(accept).not.toContain('.pdf');
    expect(accept).not.toContain('image');
  });

  it('refuses a PDF for Groq with the reason in words', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(chatElement(groq, client));
    await user.upload(upload(), file('report.pdf', 'application/pdf'));
    expect(fileError()).toHaveTextContent('Groq models read text files only. report.pdf is a PDF.');
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument();
  });

  it('takes a .md file for Groq and sends it with no made-up text', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(chatElement(groq, client));
    await user.upload(upload(), file('notes.md', ''));
    expect(fileError()).not.toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(chat.sendMessage).toHaveBeenCalledWith('', [
        { name: 'notes.md', format: 'md', bytes: 'eA==' },
      ])
    );
  });

  it.each([
    bedrock,
    model('anthropic'),
    model('ollama', { accepts: { images: true, pdf: false, office: false, text: true } }),
  ])('refuses an SVG for %s', async (m) => {
    const user = userEvent.setup({ applyAccept: false });
    render(chatElement(m, client));
    await user.upload(upload(), file('logo.svg', 'image/svg+xml'));
    expect(fileError()).toHaveTextContent(
      'logo.svg is not a PNG, JPEG, GIF, or WebP image. Convert it to one of these.'
    );
  });

  it('takes at most 5 documents in a message', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(chatElement(bedrock, client));
    const pdfs = Array.from({ length: 6 }, (_, i) => file(`f${i + 1}.pdf`, 'application/pdf'));
    await user.upload(upload(), pdfs);
    expect(fileError()).toHaveTextContent(
      'A message can have at most 5 files that are not images. f6.pdf was not added.'
    );
    expect(screen.getByText('f5.pdf')).toBeInTheDocument();
    expect(screen.queryByText('f6.pdf')).not.toBeInTheDocument();
  });

  it('takes at most 20 images in a message, also over two adds', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(chatElement(bedrock, client));
    const images = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => file(`p${from + i}.png`, 'image/png'));
    await user.upload(upload(), images(1, 15));
    await user.upload(upload(), images(16, 6));
    expect(fileError()).toHaveTextContent(
      'A message can have at most 20 images. p21.png was not added.'
    );
  });

  it('refuses a file over 4.5 MB', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(chatElement(bedrock, client));
    await user.upload(upload(), file('big.pdf', 'application/pdf', 5 * 1024 * 1024));
    expect(fileError()).toHaveTextContent('big.pdf is over 4.5 MB and was not added.');
  });

  it('blocks the send after a switch to a model that cannot read the files, and names them', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { rerender } = render(chatElement(bedrock, client));
    await user.upload(upload(), [
      file('report.pdf', 'application/pdf'),
      file('notes.md', 'text/markdown'),
    ]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello');

    rerender(chatElement(groq, client));
    expect(
      await screen.findByText(
        'This model cannot read report.pdf. Remove it or pick a different model to send.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '{Enter}');
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();

    // A switch back clears the block
    rerender(chatElement(bedrock, client));
    await waitFor(() => expect(fileError()).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();

    // Removing the file clears it too
    rerender(chatElement(groq, client));
    await screen.findByText(/This model cannot read report.pdf/);
    await user.click(screen.getAllByRole('button', { name: /Remove/ })[0]);
    await waitFor(() => expect(fileError()).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });
});
