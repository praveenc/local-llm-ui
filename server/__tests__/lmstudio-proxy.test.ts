// @vitest-environment node
import type { IncomingMessage, ServerResponse } from 'http';
import { describe, expect, it, vi } from 'vitest';

const downloaded = [
  { type: 'llm', path: 'a/vl.gguf', displayName: 'VL', modelKey: 'vl', vision: true },
  { type: 'llm', path: 'a/text.gguf', displayName: 'Text', modelKey: 'text', vision: false },
  { type: 'embedding', path: 'a/embed.gguf', displayName: 'Embed', modelKey: 'embed' },
];
vi.mock('@lmstudio/sdk', () => ({
  LMStudioClient: class {
    system = { listDownloadedModels: async () => downloaded };
  },
}));

const { handleLMStudioRequest } = await import('../lmstudio-proxy');

describe('LM Studio SDK model list', () => {
  it('keeps the vision flag of each model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let body = '';
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      end: (text: string) => {
        body = text;
      },
    } as unknown as ServerResponse;
    const req = {
      url: '/api/lmstudio-sdk/models',
      method: 'GET',
      headers: { host: 'localhost' },
    } as unknown as IncomingMessage;
    await handleLMStudioRequest(req, res);
    const { models } = JSON.parse(body) as { models: Array<{ modelId: string; vision: boolean }> };
    expect(models.map((m) => [m.modelId, m.vision])).toEqual([
      ['a/vl.gguf', true],
      ['a/text.gguf', false],
    ]);
    vi.unstubAllGlobals();
  });
});
