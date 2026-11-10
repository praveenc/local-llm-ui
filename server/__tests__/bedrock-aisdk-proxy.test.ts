// @vitest-environment node
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockModel } = vi.hoisted(() => ({ mockModel: { current: undefined as unknown } }));

// Use a mock model instead of Amazon Bedrock
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: () => () => mockModel.current,
}));
vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain: () => async () => ({}) }));

const { handleBedrockAISDKRequest } = await import('../bedrock-aisdk-proxy');

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
});
