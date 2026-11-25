import { describe, expect, it } from 'vitest';

import { runningKiroSync, trackKiroSync } from '../kiroSyncs';

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
