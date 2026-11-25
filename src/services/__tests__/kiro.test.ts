import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KiroStatus } from '../../utils/kiroStatus';
import { KiroService } from '../kiro';

const mockFetch = (response: { ok: boolean; status?: number; body?: KiroStatus }) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('KiroService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the status from /api/kiro/status', async () => {
    const fetchMock = mockFetch({ ok: true, body: { state: 'not-installed' } });
    await expect(new KiroService().getStatus()).resolves.toEqual({ state: 'not-installed' });
    expect(fetchMock).toHaveBeenCalledWith('/api/kiro/status');
  });

  it('adds refresh=1 to skip the server cache', async () => {
    const fetchMock = mockFetch({ ok: true, body: { state: 'not-installed' } });
    await new KiroService().getStatus(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/kiro/status?refresh=1');
  });

  it('throws when the server answers with an error', async () => {
    mockFetch({ ok: false, status: 500 });
    await expect(new KiroService().getStatus()).rejects.toThrow('HTTP error! status: 500');
  });
});

describe('KiroService.getModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fetchModels = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it("lists Kiro's models in Kiro's order, with their metadata", async () => {
    const fetchMock = fetchModels(200, {
      models: [
        {
          id: 'claude-opus-5.5',
          name: 'Claude Opus 5.5',
          description: 'Claude Opus 5.5 model with 1M context window',
          rateMultiplier: 2,
          effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultEffortLevel: 'high',
        },
        { id: 'auto', name: 'Auto', rateMultiplier: 1 },
      ],
    });

    const models = await new KiroService().getModels();

    expect(fetchMock).toHaveBeenCalledWith('/api/kiro/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(models.map((m) => m.modelId)).toEqual(['claude-opus-5.5', 'auto']);
    expect(models[0]).toEqual({
      modelId: 'claude-opus-5.5',
      modelName: 'Claude Opus 5.5',
      provider: 'kiro',
      supportsThinking: true,
      kiro: {
        description: 'Claude Opus 5.5 model with 1M context window',
        rateMultiplier: 2,
        effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffortLevel: 'high',
      },
    });
    expect(models[1]).toMatchObject({ supportsThinking: false, kiro: { rateMultiplier: 1 } });
  });

  it('sends refresh: true to skip the server cache', async () => {
    const fetchMock = fetchModels(200, { models: [] });
    await new KiroService().getModels(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/kiro/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: true }),
    });
  });

  it('returns no models when Kiro CLI is missing', async () => {
    fetchModels(200, { models: [] });
    await expect(new KiroService().getModels()).resolves.toEqual([]);
  });

  it('asks to sign in when Kiro is signed out', async () => {
    fetchModels(401, { error: 'Not signed in', code: 'signed-out' });
    await expect(new KiroService().getModels()).rejects.toThrow(
      'Sign in to Kiro in Preferences → Providers'
    );
  });

  it("throws the server's error otherwise", async () => {
    fetchModels(503, { error: 'Kiro did not start' });
    await expect(new KiroService().getModels()).rejects.toThrow('Kiro did not start');
  });
});

// jsdom has no ReadableStream, so the body is a reader that returns the chunks one by one
const sseResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            index < chunks.length
              ? { done: false, value: encoder.encode(chunks[index++]) }
              : { done: true, value: undefined }
          ),
        cancel: () => Promise.resolve(),
      }),
    },
  };
};

describe('KiroService.getUsage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const usage = {
    planName: 'KIRO POWER',
    resetDate: '2026-12-01',
    credits: { used: 1250, limit: 10000, percentage: 12, overages: 0, hasLimit: true },
    overagesEnabled: false,
  };

  const fetchUsage = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('posts JSON to /api/kiro/usage and returns the usage', async () => {
    const fetchMock = fetchUsage(200, { usage });
    await expect(new KiroService().getUsage()).resolves.toEqual(usage);
    expect(fetchMock).toHaveBeenCalledWith('/api/kiro/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it('returns null when Kiro cannot tell', async () => {
    fetchUsage(200, { usage: null });
    await expect(new KiroService().getUsage()).resolves.toBeNull();
  });

  it('throws when the server answers with an error', async () => {
    fetchUsage(500, {});
    await expect(new KiroService().getUsage()).rejects.toThrow('HTTP error! status: 500');
  });
});

describe('KiroService sign-in', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const line = (event: unknown) => `data: ${JSON.stringify({ login: event })}\n\n`;

  it('posts the method as JSON and reads events that are split across chunks', async () => {
    const full = line({ state: 'code', code: 'ABCD-EFGH', url: 'https://x.awsapps.com/s' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          line({ state: 'started', runId: 'r1' }),
          full.slice(0, 20),
          full.slice(20, 41),
          full.slice(41) + 'data: {"login":{"state":"error"',
          ',"message":"No"}}\n\n',
          'data: [DONE]\n\n',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];
    const controller = new AbortController();
    await new KiroService().startLogin(
      { method: 'identity-center', startUrl: 'https://x.awsapps.com/start', region: 'us-east-1' },
      { signal: controller.signal, onEvent: (event) => events.push(event) }
    );
    expect(events).toEqual([
      { state: 'started', runId: 'r1' },
      { state: 'code', code: 'ABCD-EFGH', url: 'https://x.awsapps.com/s' },
      { state: 'error', message: 'No' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/kiro/login');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      method: 'identity-center',
      startUrl: 'https://x.awsapps.com/start',
      region: 'us-east-1',
    });
    expect(init.signal).toBe(controller.signal);
  });

  it('ignores lines that are not JSON, and an event that comes without a break at the end', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(['data: nope\n\n', line({ state: 'started', runId: 'r1' }).trim()])
        )
    );
    const events: unknown[] = [];
    await new KiroService().startLogin(
      { method: 'builder-id' },
      { onEvent: (event) => events.push(event) }
    );
    expect(events).toEqual([{ state: 'started', runId: 'r1' }]);
  });

  it('skips the : ping comments of the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            ': ping\n\n',
            line({ state: 'started', runId: 'r1' }),
            ': ping\n\n: pi',
            'ng\n\n',
            line({ state: 'error', message: 'No' }),
            ': ping\n\n',
            'data: [DONE]\n\n',
          ])
        )
    );
    const events: unknown[] = [];
    await new KiroService().startLogin(
      { method: 'builder-id' },
      { onEvent: (event) => events.push(event) }
    );
    expect(events).toEqual([
      { state: 'started', runId: 'r1' },
      { state: 'error', message: 'No' },
    ]);
  });

  it('throws the error text of a 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'A sign-in is already running' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const onEvent = vi.fn();
    await expect(
      new KiroService().startLogin({ method: 'builder-id' }, { onEvent })
    ).rejects.toThrow('A sign-in is already running');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('names the status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));
    await expect(
      new KiroService().startLogin({ method: 'builder-id' }, { onEvent: vi.fn() })
    ).rejects.toThrow('HTTP error! status: 502');
  });

  it('cancels the sign-in with a JSON POST that names the run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ cancelled: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new KiroService().cancelLogin('r1')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/kiro/login/cancel');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ runId: 'r1' });
  });

  it('signs out and returns the status, or throws the error text', async () => {
    const status: KiroStatus = { state: 'not-installed' };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(status));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new KiroService().logout()).resolves.toEqual(status);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kiro/logout');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');

    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'A sign-in is running. Cancel it first.' }, { status: 409 })
    );
    await expect(new KiroService().logout()).rejects.toThrow('A sign-in is running');
  });
});
