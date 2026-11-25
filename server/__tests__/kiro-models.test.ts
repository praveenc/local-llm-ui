// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KiroStatus } from '../../src/utils/kiroStatus.ts';
import type { ConfigOption } from '../kiro/acp-types.ts';
import { KiroSignedOutError } from '../kiro/agent.ts';
import { KIRO_MODELS_FAILED, createKiroModelList } from '../kiro/models.ts';

const SIGNED_IN: KiroStatus = {
  state: 'signed-in',
  path: '~/.local/bin/kiro-cli',
  version: '3.5.0',
  account: { type: 'builder-id', email: 'me@example.com' },
};

const modelOptions = (...ids: string[]): ConfigOption[] => [
  {
    id: 'model',
    type: 'select',
    currentValue: ids[0],
    options: ids.map((value) => ({ value, name: value, _meta: { kiro: { rateMultiplier: 2 } } })),
  },
];

function setup(status: KiroStatus = SIGNED_IN) {
  const state = { status, options: modelOptions('auto', 'claude-opus-5.5'), clock: 0 };
  let counter = 0;
  const agent = {
    newSession: vi.fn(async () => {
      counter += 1;
      return { sessionId: `sess_${counter}`, configOptions: state.options };
    }),
    deleteSession: vi.fn<(sessionId: string) => Promise<void>>(async () => undefined),
  };
  const statusReader = { read: vi.fn(async () => state.status) };
  const list = createKiroModelList({ agent, statusReader, ttlMs: 1000, now: () => state.clock });
  return { state, agent, statusReader, list };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('createKiroModelList', () => {
  it.each([
    [{ state: 'not-installed' } as KiroStatus, { state: 'unavailable', models: [] }],
    [
      { state: 'unsupported', path: 'x', version: '2.0.0' } as KiroStatus,
      { state: 'unavailable', models: [] },
    ],
    [
      { state: 'signed-out', path: 'x', version: '3.5.0' } as KiroStatus,
      { state: 'signed-out', models: [] },
    ],
    [
      { state: 'error', path: 'x', message: 'boom' } as KiroStatus,
      { state: 'error', message: KIRO_MODELS_FAILED, models: [] },
    ],
  ])('maps the status %j without a session', async (status, expected) => {
    const c = setup(status);
    expect(await c.list.list()).toEqual(expected);
    expect(c.agent.newSession).not.toHaveBeenCalled();
  });

  it('makes one session, reads the models, and deletes the session', async () => {
    const c = setup();
    const result = await c.list.list();
    expect(result).toEqual({
      state: 'ok',
      models: [
        { id: 'auto', name: 'Auto', rateMultiplier: 2 },
        { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', rateMultiplier: 2 },
      ],
    });
    expect(c.agent.newSession).toHaveBeenCalledTimes(1);
    expect(c.agent.newSession).toHaveBeenCalledWith();
    expect(c.agent.deleteSession).toHaveBeenCalledWith('sess_1');
  });

  it('deletes the session also when there are no models, and does not keep the empty list', async () => {
    const c = setup();
    c.state.options = [];
    expect(await c.list.list()).toEqual({ state: 'ok', models: [] });
    expect(c.agent.deleteSession).toHaveBeenCalledWith('sess_1');
    await c.list.list();
    expect(c.agent.newSession).toHaveBeenCalledTimes(2);
  });

  it('keeps the list until the TTL ends, and refresh loads it again', async () => {
    const c = setup();
    await c.list.list();
    c.state.clock = 999;
    await c.list.list();
    expect(c.agent.newSession).toHaveBeenCalledTimes(1);
    c.state.clock = 1000;
    await c.list.list();
    expect(c.agent.newSession).toHaveBeenCalledTimes(2);
    await c.list.list(true);
    expect(c.agent.newSession).toHaveBeenCalledTimes(3);
    expect(c.statusReader.read).toHaveBeenLastCalledWith(true);
  });

  it('shares one load between concurrent calls', async () => {
    const c = setup();
    const [a, b] = await Promise.all([c.list.list(), c.list.list(true)]);
    expect(a).toEqual(b);
    expect(c.agent.newSession).toHaveBeenCalledTimes(1);
    expect(c.agent.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('update() replaces the cache and makes it fresh again', async () => {
    const c = setup();
    await c.list.list();
    c.state.clock = 900;
    c.list.update(modelOptions('kimi-k3'));
    c.list.update([]); // no models: ignored
    c.list.update('not options');
    c.state.clock = 1800;
    expect(await c.list.list()).toEqual({
      state: 'ok',
      models: [{ id: 'kimi-k3', name: 'Kimi K3', rateMultiplier: 2 }],
    });
    expect(c.agent.newSession).toHaveBeenCalledTimes(1);
  });

  it('ignores a failed delete', async () => {
    const c = setup();
    c.agent.deleteSession.mockRejectedValueOnce(new Error('gone'));
    const result = await c.list.list();
    expect(result.state).toBe('ok');
    expect(result.models).toHaveLength(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it('maps a signed-out agent and other errors, and keeps nothing', async () => {
    const c = setup();
    c.agent.newSession.mockRejectedValueOnce(new KiroSignedOutError('Kiro CLI is not signed in'));
    expect(await c.list.list()).toEqual({ state: 'signed-out', models: [] });
    c.agent.newSession.mockRejectedValueOnce(new Error('Kiro is slow'));
    // The browser gets plain text; the detail goes to the terminal
    expect(await c.list.list()).toEqual({
      state: 'error',
      message: KIRO_MODELS_FAILED,
      models: [],
    });
    expect(console.warn).toHaveBeenCalledWith('[kiro] model list failed: Error: Kiro is slow');
    expect((await c.list.list()).state).toBe('ok');
    expect(c.agent.newSession).toHaveBeenCalledTimes(3);
  });

  it('drops the cache after a sign-out and when the account changes', async () => {
    const c = setup();
    await c.list.list();
    c.state.status = { state: 'signed-out', path: 'x', version: '3.5.0' };
    await c.list.list();
    c.state.status = SIGNED_IN;
    await c.list.list();
    expect(c.agent.newSession).toHaveBeenCalledTimes(2);

    // The same account: the cache stays
    await c.list.list();
    expect(c.agent.newSession).toHaveBeenCalledTimes(2);
    c.state.status = { ...SIGNED_IN, account: { type: 'builder-id', email: 'other@example.com' } };
    await c.list.list();
    expect(c.agent.newSession).toHaveBeenCalledTimes(3);
    // The email is never logged
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('example.com');
  });
});
