// @vitest-environment node
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAD_BODIES,
  MCP_SERVER,
  abortedMcpStart,
  errorPartModel,
  events,
  post,
  postAndLeaveEarly,
  textModel,
} from './fixtures/chat-proxy-harness';

const { mockModel, mcpSpy } = vi.hoisted(() => ({
  mockModel: { current: undefined as unknown },
  mcpSpy: vi.fn(async () => ({ tools: {}, cleanup: async () => undefined })),
}));

// Use a mock model instead of OpenRouter
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => () => mockModel.current,
}));
vi.mock('../mcp-manager.ts', () => ({ getMCPTools: mcpSpy }));

const { createOpenRouterAISDKProxy } = await import('../openrouter-aisdk-proxy');

const PATH = '/api/openrouter/chat';
const KEY = { 'X-Api-Key': 'test-key' };

describe('OpenRouter chat proxy', () => {
  afterEach(() => {
    mockModel.current = undefined;
    mcpSpy.mockClear();
  });

  it('streams a reply for the body that the browser sends', async () => {
    mockModel.current = textModel(['Hi']);
    const reply = await post(
      createOpenRouterAISDKProxy(),
      PATH,
      {
        model: 'anthropic/claude-sonnet-4.5',
        messages: [{ role: 'user', content: 'Hello', files: [] }],
        max_tokens: 4096,
        maxToolSteps: 10,
        enableWebSearch: false,
      },
      KEY
    );
    expect(reply.status).toBe(200);
    expect(events(reply.body).some((p) => p.content === 'Hi')).toBe(true);
  });

  it.each(BAD_BODIES)('answers 400 JSON for %s, with no MCP start', async (_name, bad) => {
    const reply = await post(createOpenRouterAISDKProxy(), PATH, bad, KEY);
    expect(reply.status).toBe(400);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('refuses an empty message before it starts an MCP server', async () => {
    const reply = await post(
      createOpenRouterAISDKProxy(),
      PATH,
      { model: 'a/b', messages: [{ role: 'user', content: '   ' }], mcpServers: [MCP_SERVER] },
      KEY
    );
    expect([reply.status, JSON.parse(reply.body)]).toEqual([
      400,
      { error: 'At least one non-empty message is required' },
    ]);
    expect(reply.headers.get('cache-control')).toBeNull();
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('keeps its strict model id pattern', async () => {
    const reply = await post(
      createOpenRouterAISDKProxy(),
      PATH,
      { model: 'a b (c)', messages: [{ role: 'user', content: 'Hi' }] },
      KEY
    );
    expect([reply.status, JSON.parse(reply.body)]).toEqual([
      400,
      { error: 'Invalid model ID format' },
    ]);
  });

  it('cuts a 5,000-character stream error to 500 characters', async () => {
    // getSafeErrorMessage reads OpenRouter's JSON in responseBody, not the error message
    const error = Object.assign(new Error('Bad request'), {
      responseBody: JSON.stringify({ error: { message: 'e'.repeat(5000) } }),
    });
    mockModel.current = errorPartModel(error);
    const reply = await post(
      createOpenRouterAISDKProxy(),
      PATH,
      { model: 'a/b', messages: [{ role: 'user', content: 'Hi' }] },
      KEY
    );
    const errors = events(reply.body).filter((p) => 'error' in p);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('e'.repeat(500));
  });
});

describe('OpenRouter models route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Answer requests to OpenRouter with `upstream`; send the others (the test server) on */
  function stubOpenRouter(upstream: () => Promise<Response>) {
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
        String(input).startsWith('https://openrouter.ai/') ? upstream() : realFetch(input, init)
      )
    );
  }

  async function getModels() {
    const handler = createOpenRouterAISDKProxy();
    const server = createServer((req, res) => {
      void handler(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/openrouter/models`, {
        headers: KEY,
      });
      return { status: response.status, body: (await response.json()) as { error?: string } };
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  it('keeps the input modalities of each model, as strings only', async () => {
    stubOpenRouter(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'a/v', name: 'V', architecture: { input_modalities: ['text', 'image', 7] } },
              { id: 'a/t', name: 'T' },
            ],
          }),
          { status: 200 }
        )
    );
    const reply = await getModels();
    expect(reply.body).toEqual({
      provider: 'openrouter',
      models: [
        { id: 'a/v', name: 'V', inputModalities: ['text', 'image'] },
        { id: 'a/t', name: 'T', inputModalities: [] },
      ],
    });
  });

  it('cuts a 5,000-character upstream error to 500 characters', async () => {
    stubOpenRouter(
      async () =>
        new Response(JSON.stringify({ error: { message: 'e'.repeat(5000) } }), { status: 502 })
    );
    const reply = await getModels();
    expect(reply.status).toBe(502);
    expect(reply.body.error).toBe('e'.repeat(500));
  });

  it('cuts a 5,000-character error of a failed call to 500 characters', async () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    stubOpenRouter(async () => {
      throw Object.assign(new Error('fetch failed'), {
        responseBody: JSON.stringify({ error: { message: 'e'.repeat(5000) } }),
      });
    });
    const reply = await getModels();
    expect(reply.status).toBe(500);
    expect(reply.body.error).toBe('e'.repeat(500));
  });
});

describe('OpenRouter chat proxy after the browser left', () => {
  it('does not log an AbortError as a proxy error', async () => {
    mcpSpy.mockImplementationOnce(abortedMcpStart);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await postAndLeaveEarly(
        createOpenRouterAISDKProxy(),
        PATH,
        {
          ...{ model: 'a/b', messages: [{ role: 'user', content: 'Hello' }] },
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
