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

// Use a mock model instead of Anthropic
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => () => mockModel.current }));
vi.mock('../mcp-manager.ts', () => ({ getMCPTools: mcpSpy }));

const { createAnthropicProxy } = await import('../anthropic-aisdk-proxy');

const PATH = '/api/anthropic/chat';
const KEY = { 'X-Api-Key': 'test-key' };

describe('Anthropic chat proxy', () => {
  afterEach(() => {
    mockModel.current = undefined;
    mcpSpy.mockClear();
  });

  it('streams a reply for the body that the browser sends', async () => {
    mockModel.current = textModel(['Hi']);
    const reply = await post(
      createAnthropicProxy(),
      PATH,
      {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'Hello', files: [] }],
        max_tokens: 4096,
        maxToolSteps: 10,
        enableWebSearch: false,
        thinkingEffort: 'low',
      },
      KEY
    );
    expect(reply.status).toBe(200);
    expect(events(reply.body).some((p) => p.content === 'Hi')).toBe(true);
  });

  it.each(BAD_BODIES)('answers 400 JSON for %s, with no MCP start', async (_name, bad) => {
    const reply = await post(createAnthropicProxy(), PATH, bad, KEY);
    expect(reply.status).toBe(400);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(reply.headers.get('cache-control')).toBeNull();
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('answers 401 JSON when the key is missing', async () => {
    const reply = await post(createAnthropicProxy(), PATH, {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect([reply.status, JSON.parse(reply.body)]).toEqual([
      401,
      { error: 'Anthropic API key required' },
    ]);
  });
});

describe('Anthropic chat proxy after the browser left', () => {
  it('does not log an AbortError as a proxy error', async () => {
    mcpSpy.mockImplementationOnce(abortedMcpStart);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await postAndLeaveEarly(
        createAnthropicProxy(),
        PATH,
        {
          ...{ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Hello' }] },
          mcpServers: [MCP_SERVER],
        },
        KEY
      );
      expect(mcpSpy).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      mcpSpy.mockClear();
    }
  });
});
