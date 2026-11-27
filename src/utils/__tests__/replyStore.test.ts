import { describe, expect, it, vi } from 'vitest';

import type { UIMessage } from '../../types/ai-messages';
import { createReplyStore, isRunningStatus } from '../replyStore';

const msg = (id: string, role: 'user' | 'assistant' = 'user'): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text: id }],
  createdAt: new Date(0),
});

describe('replyStore', () => {
  it('starts, appends, and ends a reply in its own chat', () => {
    const store = createReplyStore();
    store.setOnScreen('a');
    const run = store.start('a', [msg('earlier')]);
    expect(store.get('a')?.status).toBe('submitted');
    expect(store.isRunning('a')).toBe(true);

    run.update({ status: 'streaming' });
    run.setMessages((m) => [...m, msg('question')]);
    run.setMessages((m) => [...m, msg('answer', 'assistant')]);
    expect(store.get('a')?.messages.map((m) => m.id)).toEqual(['earlier', 'question', 'answer']);

    run.end('done');
    run.finish();
    // On screen: the ended reply stays until the user leaves the chat
    expect(store.get('a')?.status).toBe('idle');
    expect(store.isRunning('a')).toBe(false);
    expect(run.isActive()).toBe(false);
    // Writes after the end do nothing
    run.setMessages(() => []);
    expect(store.get('a')?.messages).toHaveLength(3);
  });

  it('removes a reply that ends well off screen, and keeps a failed one', () => {
    const store = createReplyStore();
    store.setOnScreen('b');
    const a = store.start('a', []);
    a.end('done');
    expect(store.get('a')).toBeUndefined();

    const c = store.start('c', [msg('q')]);
    c.end('failed', 'Network down');
    expect(store.get('c')).toMatchObject({ status: 'error', error: 'Network down' });
  });

  it('runs two chats at once and stops only one', async () => {
    const store = createReplyStore();
    const a = store.start('a', []);
    const b = store.start('b', []);
    a.update({ status: 'streaming' });
    b.update({ status: 'streaming' });

    const stopped = store.stop('a');
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(store.get('a')).toMatchObject({ status: 'idle', wasInterrupted: true });
    expect(store.isRunning('b')).toBe(true);

    // The stopped run's catch block ends it again: the stop counts
    a.end('failed', 'AbortError');
    expect(store.get('a')?.status).toBe('idle');

    // stop waits for the run's last write
    let resolved = false;
    void stopped.then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    a.finish();
    await stopped;
    expect(resolved).toBe(true);
  });

  it('keeps the writes of a stopped run until it finishes', () => {
    const store = createReplyStore();
    store.setOnScreen('a');
    const run = store.start('a', [msg('q')]);
    void store.stop('a');
    // The catch block flushes the text received before the stop
    run.setMessages((m) => [...m, msg('partial', 'assistant')]);
    run.update({ status: 'streaming' });
    expect(store.get('a')).toMatchObject({ status: 'idle', wasInterrupted: true });
    expect(store.get('a')?.messages.map((m) => m.id)).toEqual(['q', 'partial']);
    run.finish();
    run.setMessages(() => []);
    expect(store.get('a')?.messages).toHaveLength(2);
  });

  it('resolves stop at once when nothing runs', async () => {
    const store = createReplyStore();
    await expect(store.stop('none')).resolves.toBeUndefined();
  });

  it('ignores writes of an older run after a new run of the same chat starts', () => {
    const store = createReplyStore();
    const first = store.start('a', []);
    void store.stop('a');
    const second = store.start('a', [msg('new')]);
    first.setMessages(() => [msg('old')]);
    first.end('failed', 'late');
    expect(store.get('a')).toMatchObject({ status: 'submitted', error: null });
    expect(store.get('a')?.messages.map((m) => m.id)).toEqual(['new']);
    expect(second.isActive()).toBe(true);
  });

  it('dismisses only ended replies', () => {
    const store = createReplyStore();
    store.setOnScreen('a');
    const run = store.start('a', []);
    store.dismiss('a');
    expect(store.get('a')).toBeDefined();
    run.end('stopped');
    store.dismiss('a');
    expect(store.get('a')).toBeUndefined();
  });

  it('keeps the activity object until a status or a question changes', () => {
    const store = createReplyStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const empty = store.activity();
    const run = store.start('a', []);
    const replying = store.activity();
    expect(replying).not.toBe(empty);
    expect(replying.get('a')).toBe('replying');

    run.setMessages((m) => [...m, msg('chunk', 'assistant')]);
    expect(store.activity()).toBe(replying);
    expect(listener).toHaveBeenCalled();

    run.update({ waiting: true });
    expect(store.activity().get('a')).toBe('waiting');
    run.update({ waiting: false });
    expect(store.activity().get('a')).toBe('replying');
    run.end('stopped');
    expect(store.activity().size).toBe(0);
  });

  it('shows a failed fork as an error in its chat, edits messages, and clears', () => {
    const store = createReplyStore();
    store.fail('a', [msg('q')], 'Failed to fork conversation');
    expect(store.get('a')).toMatchObject({ status: 'error', error: 'Failed to fork conversation' });
    store.editMessages('a', (m) => m.map((x) => ({ ...x, feedback: 'helpful' as const })));
    expect(store.get('a')?.messages[0].feedback).toBe('helpful');

    const run = store.start('b', []);
    store.clear();
    expect(run.signal.aborted).toBe(true);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeUndefined();
    expect(store.onScreen()).toBeNull();
  });

  it('removes an entry after a delete', () => {
    const store = createReplyStore();
    store.start('a', []);
    store.remove('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.get(null)).toBeUndefined();
    expect(store.isRunning(null)).toBe(false);
  });

  it('aborts the run that start replaces, and keeps its finished promise for stop', async () => {
    const store = createReplyStore();
    const first = store.start('a', []);
    const second = store.start('a', []);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    // The replaced run has not finished its writes yet
    let firstDone = false;
    void store.whenFinished('a').then(() => {
      firstDone = true;
    });
    await Promise.resolve();
    expect(firstDone).toBe(false);
    first.finish();
    second.finish();
    await vi.waitFor(() => expect(firstDone).toBe(true));
  });

  it('waits in whenFinished for the runs of the chat that exist at the call', async () => {
    const store = createReplyStore();
    await expect(store.whenFinished('a')).resolves.toBeUndefined();

    const old = store.start('a', []);
    void store.stop('a');
    const wait = store.whenFinished('a');
    // A run that starts after the call does not count
    const next = store.start('a', []);
    let resolved = false;
    void wait.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    old.finish();
    await wait;
    expect(resolved).toBe(true);
    // A run of another chat does not count either
    await expect(store.whenFinished('b')).resolves.toBeUndefined();
    next.finish();
    await expect(store.whenFinished('a')).resolves.toBeUndefined();
  });

  it('waits for a run that was dismissed or removed before it finished', async () => {
    const store = createReplyStore();
    const run = store.start('a', []);
    void store.stop('a');
    store.dismiss('a');
    expect(store.get('a')).toBeUndefined();
    let resolved = false;
    const wait = store.whenFinished('a').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    run.finish();
    await wait;
    expect(resolved).toBe(true);
  });

  it('stops waiting in whenFinished after the time limit', async () => {
    vi.useFakeTimers();
    try {
      const store = createReplyStore();
      store.start('a', []);
      let resolved = false;
      void store.whenFinished('a', 100).then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('knows which statuses run', () => {
    expect(isRunningStatus('submitted')).toBe(true);
    expect(isRunningStatus('streaming')).toBe(true);
    expect(isRunningStatus('idle')).toBe(false);
    expect(isRunningStatus('error')).toBe(false);
    expect(isRunningStatus(undefined)).toBe(false);
  });
});
