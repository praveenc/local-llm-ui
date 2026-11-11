// @vitest-environment node
import { MockLanguageModelV4 } from 'ai/test';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockModel } = vi.hoisted(() => ({ mockModel: { current: undefined as unknown } }));

// Use a mock model instead of LM Studio
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => () => mockModel.current,
}));

const { createLMStudioAISDKProxy } = await import('../lmstudio-aisdk-proxy');

/** Send one chat request to the proxy. Returns the status and the SSE body. */
async function chat(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const handler = createLMStudioAISDKProxy();
  const server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/lmstudio-aisdk/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model: 'qwen3-8b',
        messages: [{ role: 'user', content: 'Hello' }],
        ...extra,
      }),
    });
    return { status: response.status, body: await response.text() };
  } finally {
    server.close();
  }
}

/** A model that streams the given text deltas and then finishes */
function textModel(deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: '1' });
          for (const delta of deltas) controller.enqueue({ type: 'text-delta', id: '1', delta });
          controller.enqueue({ type: 'text-end', id: '1' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

/** The SSE data payloads of a body */
const events = (body: string): Array<Record<string, unknown>> =>
  body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);

describe('LM Studio AI SDK proxy', () => {
  afterEach(() => {
    mockModel.current = undefined;
  });

  it('streams text as content and ends with usage and [DONE]', async () => {
    mockModel.current = textModel(['Hel', 'lo']);
    const { status, body } = await chat();

    expect(status).toBe(200);
    const parts = events(body);
    const content = parts.filter((p) => 'content' in p).map((p) => p.content);
    expect(content.join('')).toBe('Hello');
    const metadata = parts.find((p) => 'metadata' in p)?.metadata as {
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    };
    expect(metadata.usage).toEqual({ inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('splits inline <think> tags into reasoning, also across chunks', async () => {
    mockModel.current = textModel(['<thi', 'nk>plan</think>', 'answer']);
    const { body } = await chat();

    const parts = events(body);
    const reasoning = parts.filter((p) => 'reasoning' in p).map((p) => p.reasoning);
    const content = parts.filter((p) => 'content' in p).map((p) => p.content);
    expect(reasoning.join('')).toBe('plan');
    expect(content.join('')).toBe('answer');
    expect(body).not.toContain('<think>');
  });

  it('refuses web search without a search API key', async () => {
    mockModel.current = textModel(['x']);
    const { status, body } = await chat({ enableWebSearch: true });

    expect(status).toBe(401);
    expect(body).toContain('Web search needs an API key');
  });

  it('passes the max tool steps and tools to the model call when web search is on', async () => {
    mockModel.current = textModel(['done']);
    const model = mockModel.current as MockLanguageModelV4;

    const { status } = await chat(
      { enableWebSearch: true, maxToolSteps: 4 },
      { 'X-Tavily-Api-Key': 'tvly-test', 'X-Web-Search-Order': 'tavily' }
    );

    expect(status).toBe(200);
    expect(model.doStreamCalls).toHaveLength(1);
    const toolNames = (model.doStreamCalls[0].tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('webSearch');
  });
});
