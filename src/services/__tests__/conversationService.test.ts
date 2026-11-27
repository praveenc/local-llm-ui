import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import { conversationService } from '../conversationService';

vi.mock('../../db', () => ({
  db: {
    messages: { get: vi.fn(), update: vi.fn() },
    conversations: { update: vi.fn() },
    transaction: vi.fn((_mode: string, _tables: unknown, work: () => Promise<unknown>) => work()),
  },
}));

describe('conversationService.setMessageFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.messages.get).mockResolvedValue({ id: 'm1' } as never);
    vi.mocked(db.messages.update).mockResolvedValue(1);
  });

  it('stores the rating on the message', async () => {
    await conversationService.setMessageFeedback('m1', 'helpful');
    expect(db.messages.update).toHaveBeenCalledWith('m1', { feedback: 'helpful' });
  });

  it('clears the rating when given null', async () => {
    await conversationService.setMessageFeedback('m1', null);
    expect(db.messages.update).toHaveBeenCalledWith('m1', { feedback: undefined });
  });

  it('fails when the message has no row', async () => {
    vi.mocked(db.messages.get).mockResolvedValue(undefined);
    vi.mocked(db.messages.update).mockResolvedValue(0);
    await expect(conversationService.setMessageFeedback('gone', 'helpful')).rejects.toThrow();
    expect(db.messages.update).not.toHaveBeenCalled();
  });

  it('does not fail when the value is already stored (update counts 0)', async () => {
    vi.mocked(db.messages.update).mockResolvedValue(0);
    await expect(conversationService.setMessageFeedback('m1', 'helpful')).resolves.toBeUndefined();
  });
});

describe('conversationService.rename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.conversations.update).mockResolvedValue(1);
  });

  it('changes only the title, so updatedAt keeps the date of the last message', async () => {
    await conversationService.rename('c1', 'New name');
    expect(db.conversations.update).toHaveBeenCalledTimes(1);
    expect(db.conversations.update).toHaveBeenCalledWith('c1', {
      title: 'New name',
      titleEdited: true,
      titleFromKiro: false,
    });
    const changes = vi.mocked(db.conversations.update).mock.calls[0][1];
    expect(changes).not.toHaveProperty('updatedAt');
  });

  it('leaves update() setting updatedAt for status changes', async () => {
    await conversationService.update('c1', { status: 'archived' });
    expect(db.conversations.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ status: 'archived', updatedAt: expect.any(Date) })
    );
  });
});
