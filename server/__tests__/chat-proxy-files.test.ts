// @vitest-environment node
// The files of a chat request in each chat proxy (D-A c): what reaches `streamText`, and the 400
// for a file type that the provider cannot take.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { post, textModel } from './fixtures/chat-proxy-harness';

const { calls, mcpSpy } = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  mcpSpy: vi.fn(async () => ({ tools: {}, cleanup: async () => undefined })),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: (options: Parameters<typeof actual.streamText>[0]) => {
      calls.push(options as unknown as Record<string, unknown>);
      return actual.streamText(options);
    },
  };
});
const model = () => textModel(['Hi']);
vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: () => () => model() }));
vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain: () => async () => ({}) }));
vi.mock('@ai-sdk/anthropic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ai-sdk/anthropic')>()),
  createAnthropic: () => () => model(),
}));
vi.mock('@ai-sdk/groq', () => ({ createGroq: () => () => model() }));
vi.mock('@ai-sdk/cerebras', () => ({ createCerebras: () => () => model() }));
vi.mock('ollama-ai-provider-v2', () => ({ createOllama: () => () => model() }));
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: () => () => model() }));
vi.mock('../mcp-manager.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mcp-manager.ts')>()),
  getMCPTools: mcpSpy,
}));

const { handleBedrockAISDKRequest } = await import('../bedrock-aisdk-proxy');
const { createAnthropicProxy } = await import('../anthropic-aisdk-proxy');
const { createAISDKProxy } = await import('../aisdk-proxy');
const { createOllamaAISDKProxy } = await import('../ollama-aisdk-proxy');
const { createLMStudioAISDKProxy } = await import('../lmstudio-aisdk-proxy');
const { createOpenRouterAISDKProxy, clearOpenRouterModalitiesCache } =
  await import('../openrouter-aisdk-proxy');
const { handleMantleRequest } = await import('../mantle-proxy');

const b64 = (text: string) => Buffer.from(text).toString('base64');
const PNG = { name: 'chart.png', format: 'png', bytes: b64('png-bytes') };
const MD = { name: 'notes.md', format: 'md', bytes: b64('# Notes') };
const PDF = { name: 'report.pdf', format: 'pdf', bytes: b64('%PDF-1.4') };
const body = (files: unknown[], extra: Record<string, unknown> = {}) => ({
  model: 'test-model',
  messages: [{ role: 'user', content: 'Look', files }],
  ...extra,
});
const KEY = { 'X-Api-Key': 'test-key' };

/** The user message that reached streamText */
const sentUser = () => {
  const messages = calls.at(-1)?.messages as Array<{ role: string; content: unknown }>;
  return messages.find((m) => m.role === 'user');
};

const pngPart = expect.objectContaining({
  type: 'file',
  mediaType: 'image/png',
  filename: expect.any(String),
});
const mdBlock = '<file name="notes.md">\n# Notes\n</file>';

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  mcpSpy.mockClear();
});

describe('chat proxies with files', () => {
  it('Bedrock: the PNG and the .md file as file parts, with clean names', async () => {
    const reply = await post(handleBedrockAISDKRequest, '/api/bedrock-aisdk/chat', body([PNG, MD]));
    expect(reply.status).toBe(200);
    expect(sentUser()?.content).toEqual([
      { type: 'text', text: 'Look' },
      expect.objectContaining({ type: 'file', mediaType: 'image/png', filename: 'chart' }),
      expect.objectContaining({ type: 'file', mediaType: 'text/markdown', filename: 'notes' }),
    ]);
  });

  it('Anthropic: the PNG as a file part and the .md file in the text', async () => {
    const reply = await post(createAnthropicProxy(), '/api/anthropic/chat', body([PNG, MD]), KEY);
    expect(reply.status).toBe(200);
    expect(sentUser()?.content).toEqual([{ type: 'text', text: `Look\n\n${mdBlock}` }, pngPart]);
  });

  it.each(['groq', 'cerebras'])('%s: the .md file in the text', async (provider) => {
    const reply = await post(createAISDKProxy(), '/api/aisdk/chat', body([MD], { provider }), KEY);
    expect(reply.status).toBe(200);
    expect(sentUser()?.content).toBe(`Look\n\n${mdBlock}`);
  });

  it.each(['groq', 'cerebras'])('%s: a PNG is a 400 before the stream', async (provider) => {
    const reply = await post(
      createAISDKProxy(),
      '/api/aisdk/chat',
      body([PNG, MD], { provider }),
      KEY
    );
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toMatch(/^Images are not supported for/);
    expect(calls).toHaveLength(0);
    expect(mcpSpy).not.toHaveBeenCalled();
  });

  it('Ollama: the PNG as a file part and the .md file in the text', async () => {
    const reply = await post(createOllamaAISDKProxy(), '/api/ollama-aisdk/chat', body([PNG, MD]));
    expect(reply.status).toBe(200);
    expect(sentUser()?.content).toEqual([{ type: 'text', text: `Look\n\n${mdBlock}` }, pngPart]);
  });

  it('Ollama: a PDF is a 400', async () => {
    const reply = await post(createOllamaAISDKProxy(), '/api/ollama-aisdk/chat', body([PDF]));
    expect([reply.status, JSON.parse(reply.body)]).toEqual([
      400,
      { error: 'PDF files are not supported for Ollama' },
    ]);
    expect(calls).toHaveLength(0);
  });

  it('LM Studio: the PNG as a file part and the .md file in the text', async () => {
    const reply = await post(
      createLMStudioAISDKProxy(),
      '/api/lmstudio-aisdk/chat',
      body([PNG, MD])
    );
    expect(reply.status).toBe(200);
    expect(sentUser()?.content).toEqual([{ type: 'text', text: `Look\n\n${mdBlock}` }, pngPart]);
  });

  it('Mantle: any file is a 400 with no upstream call', async () => {
    const upstream = vi.fn();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('api.aws')) return upstream(url, init);
      return realFetch(url, init);
    });
    const reply = await post(handleMantleRequest, '/api/mantle/chat', body([MD]), {
      'X-Mantle-Api-Key': 'test-key',
      'X-Mantle-Region': 'us-east-1',
    });
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toBe('Text files are not supported for Bedrock Mantle');
    expect(upstream).not.toHaveBeenCalled();
  });

  describe('OpenRouter', () => {
    /** Serve OpenRouter's model list with these modalities; other URLs go out as usual */
    const stubModelList = (inputModalities: string[]) => {
      const realFetch = globalThis.fetch;
      const listCalls = vi.fn();
      vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
        if (String(url).startsWith('https://openrouter.ai/')) {
          listCalls(String(url));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: 'test-model',
                    name: 'Test',
                    architecture: { input_modalities: inputModalities },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        return realFetch(url, init);
      });
      return listCalls;
    };
    beforeEach(() => clearOpenRouterModalitiesCache());

    it('the PNG as a file part, the .md file in the text, and no plugin without a PDF', async () => {
      const listCalls = stubModelList(['text', 'image']);
      const reply = await post(
        createOpenRouterAISDKProxy(),
        '/api/openrouter/chat',
        body([PNG, MD]),
        KEY
      );
      expect(reply.status).toBe(200);
      expect(sentUser()?.content).toEqual([{ type: 'text', text: `Look\n\n${mdBlock}` }, pngPart]);
      expect(calls.at(-1)?.providerOptions).toBeUndefined();
      expect(listCalls).not.toHaveBeenCalled();
    });

    it('a PDF for a model without file input sends the free cloudflare-ai parser', async () => {
      stubModelList(['text', 'image']);
      const reply = await post(
        createOpenRouterAISDKProxy(),
        '/api/openrouter/chat',
        body([PDF]),
        KEY
      );
      expect(reply.status).toBe(200);
      expect(calls.at(-1)?.providerOptions).toEqual({
        openrouter: { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] },
      });
      expect(sentUser()?.content).toEqual([
        { type: 'text', text: 'Look' },
        expect.objectContaining({
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'report.pdf',
        }),
      ]);
    });

    it('a PDF for a model with file input sends the native parser, never paid OCR', async () => {
      stubModelList(['text', 'image', 'file']);
      const reply = await post(
        createOpenRouterAISDKProxy(),
        '/api/openrouter/chat',
        body([PDF]),
        KEY
      );
      expect(reply.status).toBe(200);
      expect(calls.at(-1)?.providerOptions).toEqual({
        openrouter: { plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }] },
      });
    });

    /** OpenRouter's model list fails; other URLs go out as usual */
    const stubFailingList = () => {
      const realFetch = globalThis.fetch;
      const listCalls = vi.fn();
      vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
        if (String(url).startsWith('https://openrouter.ai/')) {
          listCalls(String(url));
          return Promise.reject(new TypeError('fetch failed'));
        }
        return realFetch(url, init);
      });
      return listCalls;
    };

    it('the list fetch fails, so the request sends cloudflare-ai', async () => {
      stubFailingList();
      const reply = await post(
        createOpenRouterAISDKProxy(),
        '/api/openrouter/chat',
        body([PDF]),
        KEY
      );
      expect(reply.status).toBe(200);
      expect(calls.at(-1)?.providerOptions).toEqual({
        openrouter: { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] },
      });
    });

    it('a failed list fetch is remembered: a second PDF request within 60 s makes no fetch', async () => {
      const listCalls = stubFailingList();
      for (let i = 0; i < 2; i++) {
        const reply = await post(
          createOpenRouterAISDKProxy(),
          '/api/openrouter/chat',
          body([PDF]),
          KEY
        );
        expect(reply.status).toBe(200);
        expect(calls.at(-1)?.providerOptions).toEqual({
          openrouter: { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] },
        });
      }
      expect(listCalls).toHaveBeenCalledTimes(1);
    });

    it('keeps the model list: a second PDF request does not fetch it again', async () => {
      const listCalls = stubModelList(['text']);
      for (let i = 0; i < 2; i++) {
        await post(createOpenRouterAISDKProxy(), '/api/openrouter/chat', body([PDF]), KEY);
      }
      expect(listCalls).toHaveBeenCalledTimes(1);
    });

    it('an Office file is a 400', async () => {
      const reply = await post(
        createOpenRouterAISDKProxy(),
        '/api/openrouter/chat',
        body([{ name: 'a.docx', format: 'docx', bytes: b64('x') }]),
        KEY
      );
      expect([reply.status, JSON.parse(reply.body)]).toEqual([
        400,
        { error: 'Office files are not supported for OpenRouter' },
      ]);
    });
  });
});
