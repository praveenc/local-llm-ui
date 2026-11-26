import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { replyStore } from '../../utils/replyStore';
import { notifyReply, setFallbackReplyOpener, setReplyOpener } from '../replyNotices';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const get = vi.hoisted(() => vi.fn(async (id: string) => ({ id, title: 'Count to 150' })));
vi.mock('../conversationService', () => ({ conversationService: { get } }));

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  for (const fn of Object.values(toast)) fn.mockClear();
  get.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  setFallbackReplyOpener(null);
});

/** The options of the only toast that showed */
const shown = (kind: keyof typeof toast) => {
  expect(toast[kind]).toHaveBeenCalledTimes(1);
  return toast[kind].mock.calls[0] as [
    string,
    { id: string; description: string; action: { label: string; onClick: () => void } },
  ];
};

describe('notifyReply', () => {
  it('shows "Reply ready" with the title and Open for a chat that is not on screen', async () => {
    const open = vi.fn();
    const remove = setReplyOpener(open);
    replyStore.setOnScreen('B');
    await notifyReply('A', 'done');

    const [title, options] = shown('success');
    expect(title).toBe('Reply ready');
    expect(options).toMatchObject({ id: 'reply-A', description: 'Count to 150' });
    expect(options.action.label).toBe('Open');
    options.action.onClick();
    expect(open).toHaveBeenCalledWith('A');
    remove();
  });

  it('shows no toast for the chat on screen, and one when the tab is hidden', async () => {
    replyStore.setOnScreen('A');
    await notifyReply('A', 'done');
    expect(toast.success).not.toHaveBeenCalled();

    visibility = 'hidden';
    await notifyReply('A', 'done');
    expect(shown('success')[0]).toBe('Reply ready');
  });

  it('shows no toast for a stopped reply', async () => {
    replyStore.setOnScreen('B');
    await notifyReply('A', 'stopped');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('shows "Reply failed" and the Kiro question off screen', async () => {
    replyStore.setOnScreen(null);
    await notifyReply('A', 'failed');
    expect(shown('error')[0]).toBe('Reply failed');
    await notifyReply('A', 'waiting');
    const [title, options] = shown('info');
    expect(title).toBe('Kiro is waiting for your answer');
    // One toast per chat: the same id replaces the earlier toast
    expect(options.id).toBe('reply-A');
  });

  it('uses the last sidebar opener, else the app opener', async () => {
    const app = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    setFallbackReplyOpener(app);
    const removeFirst = setReplyOpener(first);
    const removeSecond = setReplyOpener(second);
    replyStore.setOnScreen(null);
    await notifyReply('A', 'done');
    const open = shown('success')[1].action.onClick;

    open();
    expect(second).toHaveBeenCalledWith('A');
    removeSecond();
    open();
    expect(first).toHaveBeenCalledWith('A');
    removeFirst();
    open();
    expect(app).toHaveBeenCalledWith('A');
  });

  it('uses a plain title when the chat cannot be read', async () => {
    get.mockRejectedValueOnce(new Error('gone'));
    replyStore.setOnScreen(null);
    await notifyReply('A', 'done');
    expect(shown('success')[1].description).toBe('New conversation');
  });
});
