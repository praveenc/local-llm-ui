import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBedrockChat } from '../useBedrockChat';
import type { ChatModel } from '../useBedrockChat';

vi.mock('../index', () => ({
  useConversation: () => ({ conversation: undefined, messages: undefined, isLoading: false }),
  useConversationMutations: () => ({
    createConversation: vi.fn(async () => ({ id: 'conv-1' })),
    addMessage: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'saved-1' })),
    getNextSequence: vi.fn(async () => 1),
    deleteMessagesFromSequence: vi.fn(async () => 0),
    forkConversation: vi.fn(),
    setMessageFeedback: vi.fn(),
  }),
}));

const STORAGE_KEY = 'local-llm-ui-preferences';

const mcpServer = {
  id: 's1',
  name: 'Fetch',
  enabled: true,
  transport: 'stdio',
  command: 'uvx',
  args: ['mcp-server-fetch'],
  env: {},
};

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
let requests: CapturedRequest[] = [];

beforeEach(() => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ braveApiKey: 'brave-1', mcpServers: { s1: mcpServer } })
  );
  requests = [];
  const reader = { read: vi.fn(async () => ({ done: true, value: undefined })) };
  globalThis.fetch = vi.fn(
    async (url: string, opts: { headers: Record<string, string>; body: string }) => {
      requests.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
      return { ok: true, body: { getReader: () => reader } };
    }
  ) as never;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  localStorage.clear();
  vi.restoreAllMocks();
});

const send = async (selectedModel: ChatModel, enableWebSearch: boolean) => {
  const { result } = renderHook(() =>
    useBedrockChat({
      conversationId: null,
      selectedModel,
      maxTokens: 4096,
      maxToolSteps: 10,
      thinkingEffort: 'default',
      enableWebSearch,
    })
  );
  await act(async () => {
    await result.current.sendMessage('hello');
  });
  expect(requests).toHaveLength(1);
  return requests[0];
};

describe('useBedrockChat tools', () => {
  it('sends web search with its key headers, and the MCP servers, for a tool model', async () => {
    const request = await send({ id: 'qwen3:8b', name: 'qwen3:8b', provider: 'ollama' }, true);
    expect(request.body.enableWebSearch).toBe(true);
    expect(request.body.mcpServers).toEqual([mcpServer]);
    expect(request.headers['X-Brave-Api-Key']).toBe('brave-1');
    expect(request.headers['X-Web-Search-Order']).toBe('brave');
  });

  it('sends no web search and no MCP servers for a model that cannot use tools', async () => {
    const request = await send(
      { id: 'gemma3:4b', name: 'gemma3:4b', provider: 'ollama', supportsTools: false },
      true
    );
    expect(request.url).toBe('/api/ollama-aisdk/chat');
    expect(request.body.enableWebSearch).toBe(false);
    expect(request.body).not.toHaveProperty('mcpServers');
    expect(request.headers).not.toHaveProperty('X-Brave-Api-Key');
    expect(request.headers).not.toHaveProperty('X-Web-Search-Order');
  });

  it('sends no key headers when web search is off', async () => {
    const request = await send({ id: 'qwen3:8b', name: 'qwen3:8b', provider: 'ollama' }, false);
    expect(request.body.enableWebSearch).toBe(false);
    expect(request.headers).not.toHaveProperty('X-Brave-Api-Key');
    expect(request.body.mcpServers).toEqual([mcpServer]);
  });

  it('sends only the MCP servers that are enabled and complete', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mcpServers: {
          s1: mcpServer,
          noCommand: { ...mcpServer, id: 'noCommand', command: '' },
          noName: { ...mcpServer, id: 'noName', name: ' ' },
          off: { ...mcpServer, id: 'off', enabled: false },
          noUrl: {
            id: 'noUrl',
            name: 'Remote',
            enabled: true,
            transport: 'http',
            url: '',
            headers: {},
          },
        },
      })
    );
    const request = await send({ id: 'qwen3:8b', name: 'qwen3:8b', provider: 'ollama' }, false);
    expect(request.body.mcpServers).toEqual([mcpServer]);
  });

  it('sends no MCP servers when none is complete', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mcpServers: { s1: { ...mcpServer, command: '' } } })
    );
    const request = await send({ id: 'qwen3:8b', name: 'qwen3:8b', provider: 'ollama' }, false);
    expect(request.body).not.toHaveProperty('mcpServers');
  });
});
