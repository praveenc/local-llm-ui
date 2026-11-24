import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import { conversationService } from '../conversationService';

vi.mock('../../db', () => ({
  db: { messages: { update: vi.fn() }, conversations: { update: vi.fn() } },
}));

describe('conversationService.setMessageFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe('conversationService.rename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.conversations.update).mockResolvedValue(1);
  });

  it('changes only the title, so updatedAt keeps the date of the last message', async () => {
    await conversationService.rename('c1', 'New name');
    expect(db.conversations.update).toHaveBeenCalledTimes(1);
    expect(db.conversations.update).toHaveBeenCalledWith('c1', { title: 'New name' });
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
