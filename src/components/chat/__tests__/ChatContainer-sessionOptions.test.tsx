import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../../db';
import type { Conversation } from '../../../db/types';
import type { UnifiedModel } from '../../../hooks/useAllModels';
import {
  NEW_CHAT_KEY,
  clearPendingSessionOptions,
  pendingSessionOptions,
} from '../../../hooks/useSessionOptions';
import { kiroService } from '../../../services/kiro';
import type { SessionOptionsSnapshot } from '../../../utils/sessionOptions';
import ChatContainer from '../ChatContainer';

const chat = vi.hoisted(() => ({ status: 'idle' as string }));

vi.mock('../../../hooks/useBedrockChat', () => ({
  useBedrockChat: () => ({
    messages: [],
    status: chat.status,
    error: null,
    wasInterrupted: false,
    streamStatus: null,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    retryLast: vi.fn(),
    forkAndSend: vi.fn(),
    rateMessage: vi.fn(),
    stopGeneration: vi.fn(),
    clearMessages: vi.fn(),
  }),
}));

const SESSION = 'sess_00000000-0000-4000-8000-000000000009';

const kiroModel: UnifiedModel = {
  id: 'claude-haiku-5.5',
  name: 'Claude Haiku 5.5',
  provider: 'kiro',
  providerName: 'Kiro',
};

const bedrockModel: UnifiedModel = {
  id: 'global.anthropic.claude-haiku-5-5',
  name: 'Global Anthropic Claude Haiku 5.5',
  provider: 'bedrock',
  providerName: 'Amazon Bedrock',
};

const agents = (...ids: string[]) =>
  ids.map((id) => ({ value: id, name: `Agent ${id.slice(-1).toUpperCase()}` }));

const defaults: SessionOptionsSnapshot = {
  mode: {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: 'agent-a',
    values: agents('agent-a', 'agent-b'),
  },
  options: [
    {
      id: 'autopilot',
      name: 'Autopilot',
      currentValue: 'on',
      values: [
        { value: 'on', name: 'Autopilot' },
        { value: 'off', name: 'Supervised' },
      ],
    },
  ],
};

/** Kiro's defaults reach the service through the models response, as in the app */
async function loadDefaults(sessionOptions: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ models: [], sessionOptions }),
    })
  );
  await kiroService.getModels();
}

const chatElement = (selectedModel: UnifiedModel, conversationId: string | null = null) => (
  <QueryClientProvider client={new QueryClient()}>
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
      conversationId={conversationId}
    />
  </QueryClientProvider>
);

const conversation = (kiro: Conversation['kiro']): Conversation => ({
  id: 'conv-k9',
  title: 'Chat',
  createdAt: new Date(),
  updatedAt: new Date(),
  status: 'active',
  messageCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  providers: ['kiro'],
  models: ['claude-haiku-5.5'],
  kiro,
});

beforeEach(async () => {
  await db.conversations.clear();
  await loadDefaults(defaults);
});

afterEach(() => {
  vi.unstubAllGlobals();
  chat.status = 'idle';
  clearPendingSessionOptions(NEW_CHAT_KEY);
  clearPendingSessionOptions('conv-k9');
});

describe('ChatContainer session options (K9)', () => {
  it("shows Kiro's default agent and options in words for a new Kiro chat", () => {
    render(chatElement(kiroModel));
    expect(screen.getByRole('button', { name: 'Agent: Agent A' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Session options: Autopilot: Autopilot' })
    ).toBeInTheDocument();
  });

  it('shows a pick at once and keeps it for the next message', async () => {
    const user = userEvent.setup();
    render(chatElement(kiroModel));
    await user.click(screen.getByRole('button', { name: /Session options/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Supervised' }));

    expect(
      await screen.findByRole('button', { name: 'Session options: Autopilot: Supervised' })
    ).toBeInTheDocument();
    expect(pendingSessionOptions(NEW_CHAT_KEY)).toEqual({ autopilot: 'off' });

    // Picking the shown value again leaves nothing to send
    await user.click(screen.getByRole('button', { name: /Session options/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Autopilot' }));
    await waitFor(() => expect(pendingSessionOptions(NEW_CHAT_KEY)).toBeUndefined());
  });

  it('shows nothing new for a model of another provider', () => {
    render(chatElement(bedrockModel));
    expect(screen.queryByRole('button', { name: /^Agent:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Session options/ })).not.toBeInTheDocument();
  });

  it('shows nothing when Kiro lists no session options', async () => {
    await loadDefaults(undefined);
    render(chatElement(kiroModel));
    expect(screen.queryByRole('button', { name: /^Agent:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Session options/ })).not.toBeInTheDocument();
  });

  it("shows the chat's stored values after a reload", async () => {
    await db.conversations.add(
      conversation({
        sessionId: SESSION,
        seenMessages: 2,
        options: { mode: 'agent-b', autopilot: 'off' },
      })
    );
    const first = render(chatElement(kiroModel, 'conv-k9'));
    expect(await screen.findByRole('button', { name: 'Agent: Agent B' })).toBeInTheDocument();
    first.unmount();

    render(chatElement(kiroModel, 'conv-k9'));
    expect(await screen.findByRole('button', { name: 'Agent: Agent B' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Session options: Autopilot: Supervised' })
    ).toBeInTheDocument();
  });

  it("uses the session's own lists when the tab has them", async () => {
    await db.conversations.add(
      conversation({ sessionId: SESSION, seenMessages: 2, options: { mode: 'agent-c' } })
    );
    kiroService.rememberSessionOptions(SESSION, {
      mode: { ...defaults.mode!, currentValue: 'agent-c', values: agents('agent-a', 'agent-c') },
      options: [],
    });
    render(chatElement(kiroModel, 'conv-k9'));
    expect(await screen.findByRole('button', { name: 'Agent: Agent C' })).toBeInTheDocument();
    // This session lists no other options
    expect(screen.queryByRole('button', { name: /Session options/ })).not.toBeInTheDocument();
  });

  it('turns both controls off while a reply streams', () => {
    chat.status = 'streaming';
    render(chatElement(kiroModel));
    expect(screen.getByRole('button', { name: /^Agent:/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Session options/ })).toBeDisabled();
  });
});
