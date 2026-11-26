import { describe, expect, it, vi } from 'vitest';

import { prepareKiroSend, runningKiroSync, setKiroSendCheck, trackKiroSync } from '../kiroSyncs';

function gate() {
  let open: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

describe('kiroSyncs', () => {
  it('keeps a sync until it ends, and never rejects', async () => {
    const work = gate();
    void trackKiroSync('c1', work.promise);
    const running = runningKiroSync('c1');
    expect(running).toBeDefined();
    expect(runningKiroSync('c2')).toBeUndefined();
    work.fail(new Error('no'));
    await expect(running).resolves.toBeUndefined();
    await Promise.resolve();
    expect(runningKiroSync('c1')).toBeUndefined();
  });

  it('waits for the first sync when a second one ends first', async () => {
    const first = gate();
    void trackKiroSync('c3', first.promise);
    void trackKiroSync('c3', Promise.resolve());
    await Promise.resolve();
    const running = runningKiroSync('c3');
    expect(running).toBeDefined();
    let ended = false;
    void running!.then(() => {
      ended = true;
    });
    await Promise.resolve();
    expect(ended).toBe(false);
    first.open();
    await running;
    expect(ended).toBe(true);
  });
});

describe('prepareKiroSend (K11)', () => {
  it('ends at once with no check and no running sync', async () => {
    const onSync = vi.fn();
    await prepareKiroSend('k1', onSync);
    expect(onSync).not.toHaveBeenCalled();
  });

  it('waits for a running sync, then runs the check', async () => {
    const work = gate();
    void trackKiroSync('k2', work.promise);
    const check = vi.fn(async () => undefined);
    const unset = setKiroSendCheck(check);
    const onSync = vi.fn();
    let ended = false;
    const done = prepareKiroSend('k2', onSync).then(() => {
      ended = true;
    });
    expect(onSync).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
    work.open();
    await done;
    expect(ended).toBe(true);
    expect(check).toHaveBeenCalledWith('k2', onSync);
    unset();
    await prepareKiroSend('k2', onSync);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not reject when the check fails, and an old check does not remove a newer one', async () => {
    const unsetFirst = setKiroSendCheck(async () => {
      throw new Error('no');
    });
    await expect(prepareKiroSend('k3', vi.fn())).resolves.toBeUndefined();
    const check = vi.fn(async () => undefined);
    const unset = setKiroSendCheck(check);
    unsetFirst();
    await prepareKiroSend('k3', vi.fn());
    expect(check).toHaveBeenCalledTimes(1);
    unset();
  });
});
