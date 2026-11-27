// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAD_BODIES,
  MCP_SERVER,
  abortedMcpStart,
  errorPartModel,
  events,
  hangingModel,
  post,
  postAndLeave,
  postAndLeaveEarly,
  textModel,
} from './fixtures/chat-proxy-harness';

const { mockModel, mcpSpy } = vi.hoisted(() => ({
  mockModel: { current: undefined as unknown },
  mcpSpy: vi.fn(async () => ({ tools: {}, cleanup: async () => undefined })),
}));

// Use a mock model instead of Groq and Cerebras
vi.mock('@ai-sdk/groq', () => ({ createGroq: () => () => mockModel.current }));
vi.mock('@ai-sdk/cerebras', () => ({ createCerebras: () => () => mockModel.current }));
vi.mock('../mcp-manager.ts', () => ({ getMCPTools: mcpSpy }));

const { createAISDKProxy } = await import('../aisdk-proxy');

const PATH = '/api/aisdk/chat';
const KEY = { 'X-Api-Key': 'test-key' };
const body = (extra: Record<string, unknown> = {}) => ({
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  messages: [{ role: 'user', content: 'Hello', files: [] }],
  max_tokens: 4096,
  maxToolSteps: 10,
  enableWebSearch: false,
  ...extra,
});

/** A bad body that is a JSON object, with `provider: 'groq'` */
function withProvider(bad: string): string {
  try {
    const parsed: unknown = JSON.parse(bad);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return JSON.stringify({ provider: 'groq', ...parsed });
    }
  } catch {
    // Not JSON: send it as it is
  }
  return bad;
}

describe('Groq and Cerebras chat proxy', () => {
  afterEach(() => {
    mockModel.current = undefined;
    mcpSpy.mockClear();
  });

  it('streams a reply for the body that the browser sends', async () => {
    mockModel.current = textModel(['Hel', 'lo']);
    const reply = await post(createAISDKProxy(), PATH, body(), KEY);
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toBe('text/event-stream');
    const content = events(reply.body).filter((p) => 'content' in p);
    expect(content.map((p) => p.content).join('')).toBe('Hello');
  });

  it.each(BAD_BODIES)('answers 400 JSON for %s, with no MCP start', async (_name, bad) => {
    // A valid provider, so that the shared checks, not the provider check, refuse the body
    const reply = await post(createAISDKProxy(), PATH, withProvider(bad), KEY);
    expect(reply.status).toBe(400);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(typeof (JSON.parse(reply.body) as { error: unknown }).error).toBe('string');
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('answers 400 for a provider that it does not serve', async () => {
    const reply = await post(createAISDKProxy(), PATH, body({ provider: 'openai' }), KEY);
    expect([reply.status, JSON.parse(reply.body)]).toEqual([400, { error: 'Invalid provider' }]);
  });

  it('answers 401 JSON with no SSE headers when the key is missing', async () => {
    const reply = await post(createAISDKProxy(), PATH, body());
    expect(reply.status).toBe(401);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(reply.headers.get('cache-control')).toBeNull();
  });

  it('cuts a 5,000-character stream error to 500 characters', async () => {
    mockModel.current = errorPartModel('e'.repeat(5000));
    const reply = await post(createAISDKProxy(), PATH, body(), KEY);
    const errors = events(reply.body).filter((p) => 'error' in p);
    expect(errors).toHaveLength(1);
    expect((errors[0].error as string).length).toBeLessThanOrEqual(500);
  });

  it('aborts the model call when the browser closes the connection', async () => {
    const seen: { signal?: AbortSignal } = {};
    mockModel.current = hangingModel(seen);
    await postAndLeave(createAISDKProxy(), PATH, body(), KEY);
    expect(seen.signal?.aborted).toBe(true);
  });
});

describe('Groq and Cerebras chat proxy after the browser left', () => {
  it('does not log an AbortError as a proxy error', async () => {
    mcpSpy.mockImplementationOnce(abortedMcpStart);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await postAndLeaveEarly(
        createAISDKProxy(),
        PATH,
        { ...body(), mcpServers: [MCP_SERVER] },
        KEY
      );
      expect(mcpSpy).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      mcpSpy.mockClear();
    }
  });

  it('still logs an error that is not an abort', async () => {
    mcpSpy.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      throw new Error('spawn npx ENOENT');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await postAndLeaveEarly(
        createAISDKProxy(),
        PATH,
        { ...body(), mcpServers: [MCP_SERVER] },
        KEY
      );
      expect(log).toHaveBeenCalledWith('AI SDK Proxy error (groq):', expect.any(Error));
    } finally {
      log.mockRestore();
      mcpSpy.mockClear();
    }
  });
});
