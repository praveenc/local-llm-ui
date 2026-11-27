// @vitest-environment node
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockModel, statusSpy, mcpSpy } = vi.hoisted(() => ({
  mockModel: { current: undefined as unknown },
  statusSpy: vi.fn(async () => [] as unknown[]),
  mcpSpy: vi.fn(async () => ({ tools: {}, cleanup: async () => undefined })),
}));

// Use a mock model instead of Amazon Bedrock
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: () => () => {
    if (mockModel.current instanceof Error) throw mockModel.current;
    return mockModel.current;
  },
}));
vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain: () => async () => ({}) }));
// The status route only: no MCP server starts in these tests
vi.mock('../mcp-manager.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mcp-manager.ts')>()),
  getMCPServerStatus: statusSpy,
  getMCPTools: mcpSpy,
}));

const { handleBedrockAISDKRequest } = await import('../bedrock-aisdk-proxy');
const harness = await import('./fixtures/chat-proxy-harness');

/** Send one request to the proxy. Returns the status and the body text. */
async function post(path: string, body: unknown) {
  const server = createServer((req, res) => {
    void handleBedrockAISDKRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.text() };
  } finally {
    server.close();
  }
}

/** Send one chat request to the proxy. Returns the response body and the handler's promise. */
async function chat(extra: Record<string, unknown> = {}) {
  let handled: Promise<void> | undefined;
  const server = createServer((req, res) => {
    handled = handleBedrockAISDKRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/bedrock-aisdk/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'global.anthropic.claude-test',
        messages: [{ role: 'user', content: 'Hello' }],
        ...extra,
      }),
    });
    return { status: response.status, body: await response.text(), handled };
  } finally {
    server.close();
  }
}

describe('Bedrock AI SDK proxy errors', () => {
  afterEach(() => {
    mockModel.current = undefined;
    mcpSpy.mockClear();
  });

  it.each(harness.BAD_BODIES)('answers 400 JSON for %s, with no MCP start', async (_name, bad) => {
    const reply = await harness.post(handleBedrockAISDKRequest, '/api/bedrock-aisdk/chat', bad);
    expect(reply.status).toBe(400);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(typeof (JSON.parse(reply.body) as { error: unknown }).error).toBe('string');
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('takes the body that the browser sends, with files on every message', async () => {
    mockModel.current = harness.textModel(['Hi']);
    const { status, body } = await chat({
      messages: [
        { role: 'user', content: 'Hello', files: [] },
        { role: 'assistant', content: 'Hi', files: [] },
        { role: 'user', content: 'Again', files: [] },
      ],
      max_tokens: 4096,
      maxToolSteps: 10,
      enableWebSearch: false,
      thinkingEffort: 'default',
    });
    expect(status).toBe(200);
    expect(body).toContain('"content":"Hi"');
  });

  it('cleans up MCP and caps the JSON error when a step after the MCP start throws', async () => {
    const cleanup = vi.fn(async () => undefined);
    mcpSpy.mockImplementationOnce(async () => ({ tools: {}, cleanup }));
    mockModel.current = new Error('e'.repeat(5000));
    const { status, body } = await chat({
      mcpServers: [{ id: 's1', name: 'files', type: 'stdio', command: 'npx', enabled: true }],
    });
    expect(status).toBe(500);
    expect(mcpSpy).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalled();
    const { error, errorDetail } = JSON.parse(body) as { error: string; errorDetail: string };
    expect(error.length).toBeLessThanOrEqual(500);
    expect(errorDetail).toBe('e'.repeat(500));
  });

  it('aborts the model call when the browser closes the connection', async () => {
    const seen: { signal?: AbortSignal } = {};
    mockModel.current = harness.hangingModel(seen);
    await harness.postAndLeave(handleBedrockAISDKRequest, '/api/bedrock-aisdk/chat', {
      model: 'global.anthropic.claude-test',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(seen.signal?.aborted).toBe(true);
  });

  it('reports a model error in the stream and does not throw', async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          message: "data retention mode 'default' is not available for this model",
          url: 'https://bedrock-runtime.us-west-2.amazonaws.com',
          requestBodyValues: {},
          statusCode: 400,
          isRetryable: false,
        });
      },
    });

    const { status, body, handled } = await chat();

    // Before the fix, the handler threw ERR_HTTP_HEADERS_SENT and the dev server stopped
    await expect(handled).resolves.toBeUndefined();
    expect(status).toBe(200);
    expect(body).toContain("data retention mode 'default' is not available for this model");
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('does not send temperature or top_p to the model', async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: '1' });
            controller.enqueue({ type: 'text-delta', id: '1', delta: 'Hi' });
            controller.enqueue({ type: 'text-end', id: '1' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      }),
    });
    const model = mockModel.current as MockLanguageModelV4;

    // An old client can still send the values; the proxy must drop them
    const { handled } = await chat({ temperature: 0.5, top_p: 0.9 });
    await handled;

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0].temperature).toBeUndefined();
    expect(model.doStreamCalls[0].topP).toBeUndefined();
  });

  it('sends reasoning_effort to Grok in additionalModelRequestFields', async () => {
    mockModel.current = textModel();
    const model = mockModel.current as MockLanguageModelV4;

    const { handled } = await chat({ model: 'global.xai.grok-4.7', thinkingEffort: 'off' });
    await handled;

    expect(model.doStreamCalls).toHaveLength(1);
    const options = model.doStreamCalls[0].providerOptions?.amazonBedrock as Record<
      string,
      unknown
    >;
    // Grok cannot turn reasoning off, so Off sends its lowest level
    expect(options.additionalModelRequestFields).toEqual({ reasoning_effort: 'low' });
    expect(options.reasoningConfig).toBeUndefined();
  });
});

/** A mock model that answers "Hi" */
function textModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: '1' });
          controller.enqueue({ type: 'text-delta', id: '1', delta: 'Hi' });
          controller.enqueue({ type: 'text-end', id: '1' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

describe('MCP status route', () => {
  afterEach(() => statusSpy.mockClear());

  it.each([
    ['true', true, true],
    ['the string "true"', 'true', false],
    ['1', 1, false],
    ['no value', undefined, false],
  ])('passes closeOthers %s as %s', async (_label, closeOthers, expected) => {
    const mcpServers = [{ id: 's1', name: 'One' }];
    const { status, body } = await post('/api/bedrock-aisdk/mcp-status', {
      mcpServers,
      closeOthers,
    });

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ servers: [] });
    expect(statusSpy).toHaveBeenCalledWith(mcpServers, { closeOthers: expected });
  });
});

describe('Bedrock chat proxy after the browser left', () => {
  it('does not log an AbortError as a proxy error', async () => {
    mcpSpy.mockImplementationOnce(harness.abortedMcpStart);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await harness.postAndLeaveEarly(handleBedrockAISDKRequest, '/api/bedrock-aisdk/chat', {
        ...{
          model: 'global.anthropic.claude-test',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        mcpServers: [harness.MCP_SERVER],
      });
      expect(mcpSpy).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      mcpSpy.mockClear();
    }
  });
});
