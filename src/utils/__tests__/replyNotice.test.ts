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

  it('shows no toast on screen or after a stop', () => {
    expect(replyNotice('done', 'a', true)).toBeNull();
    expect(replyNotice('failed', 'a', true)).toBeNull();
    expect(replyNotice('waiting', 'a', true)).toBeNull();
    expect(replyNotice('stopped', 'a', false)).toBeNull();
  });

  it('follows other rules, for example a toast for every reply', () => {
    const rules = { ...REPLY_NOTICE_RULES, done: 'always' as const };
    expect(replyNotice('done', 'a', true, rules)?.title).toBe('Reply ready');
  });

  it('gives one toast id per chat', () => {
    expect(replyToastId('a')).toBe(replyToastId('a'));
    expect(replyToastId('a')).not.toBe(replyToastId('b'));
  });
});
