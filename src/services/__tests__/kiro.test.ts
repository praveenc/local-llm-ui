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

  it('lists no models', async () => {
    await expect(new KiroService().getModels()).resolves.toEqual([]);
  });
});
