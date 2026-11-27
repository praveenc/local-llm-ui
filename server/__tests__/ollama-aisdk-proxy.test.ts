// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAD_BODIES,
  MCP_SERVER,
  abortedMcpStart,
  events,
  post,
  postAndLeaveEarly,
  textModel,
} from './fixtures/chat-proxy-harness';

const { mockModel, mcpSpy } = vi.hoisted(() => ({
  mockModel: { current: undefined as unknown },
  mcpSpy: vi.fn(async () => ({ tools: {}, cleanup: async () => undefined })),
}));

// Use a mock model instead of Ollama
vi.mock('ollama-ai-provider-v2', () => ({ createOllama: () => () => mockModel.current }));
vi.mock('../mcp-manager.ts', () => ({ getMCPTools: mcpSpy }));

const { createOllamaAISDKProxy } = await import('../ollama-aisdk-proxy');

const PATH = '/api/ollama-aisdk/chat';

describe('Ollama chat proxy', () => {
  afterEach(() => {
    mockModel.current = undefined;
    mcpSpy.mockClear();
  });

  it('streams a reply for the body that the browser sends', async () => {
    mockModel.current = textModel(['Hi']);
    const reply = await post(createOllamaAISDKProxy(), PATH, {
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'Hello', files: [] }],
      max_tokens: 4096,
      maxToolSteps: 10,
      enableWebSearch: false,
    });
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toBe('text/event-stream');
    expect(events(reply.body).some((p) => p.content === 'Hi')).toBe(true);
  });

  it.each(BAD_BODIES)('answers 400 JSON for %s, with no MCP start', async (_name, bad) => {
    const reply = await post(createOllamaAISDKProxy(), PATH, bad);
    expect(reply.status).toBe(400);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('answers 400, not a raw TypeError, for a body with no model', async () => {
    const reply = await post(createOllamaAISDKProxy(), PATH, {
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect([reply.status, JSON.parse(reply.body)]).toEqual([
      400,
      { error: 'Invalid chat request' },
    ]);
  });

  it('answers the missing web search key with 401 JSON and no SSE headers', async () => {
    const reply = await post(createOllamaAISDKProxy(), PATH, {
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'Hello' }],
      enableWebSearch: true,
    });
    expect(reply.status).toBe(401);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(reply.headers.get('cache-control')).toBeNull();
  });
});

describe('Ollama chat proxy after the browser left', () => {
  it('does not log an AbortError as a proxy error', async () => {
    mcpSpy.mockImplementationOnce(abortedMcpStart);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await postAndLeaveEarly(createOllamaAISDKProxy(), PATH, {
        ...{ model: 'llama3.2:3b', messages: [{ role: 'user', content: 'Hello' }] },
        mcpServers: [MCP_SERVER],
      });
      expect(mcpSpy).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      mcpSpy.mockClear();
    }
  });
});
