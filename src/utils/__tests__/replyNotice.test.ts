import { describe, expect, it } from 'vitest';

import { REPLY_NOTICE_RULES, replyNotice, replyToastId } from '../replyNotice';

describe('replyNotice', () => {
  it('shows a toast for a reply that ends off screen', () => {
    expect(replyNotice('done', 'a', false)).toEqual({
      kind: 'success',
      title: 'Reply ready',
      toastId: 'reply-a',
    });
    expect(replyNotice('failed', 'a', false)).toMatchObject({
      kind: 'error',
      title: 'Reply failed',
    });
    expect(replyNotice('waiting', 'a', false)?.title).toBe('Kiro is waiting for your answer');
  });

  it('shows a toast for a reply that ends or fails in the chat on screen', () => {
    expect(replyNotice('done', 'a', true)?.title).toBe('Reply ready');
    expect(replyNotice('failed', 'a', true)?.title).toBe('Reply failed');
  });

  it('shows no toast for a Kiro question on screen, or after a stop', () => {
    expect(replyNotice('waiting', 'a', true)).toBeNull();
    expect(replyNotice('stopped', 'a', true)).toBeNull();
    expect(replyNotice('stopped', 'a', false)).toBeNull();
  });

  it('follows other rules, for example a toast only off screen', () => {
    const rules = { ...REPLY_NOTICE_RULES, done: 'off-screen' as const };
    expect(replyNotice('done', 'a', true, rules)).toBeNull();
    expect(replyNotice('done', 'a', false, rules)?.title).toBe('Reply ready');
  });

  it('gives one toast id per chat', () => {
    expect(replyToastId('a')).toBe(replyToastId('a'));
    expect(replyToastId('a')).not.toBe(replyToastId('b'));
  });
});
