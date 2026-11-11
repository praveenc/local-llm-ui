import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../db';
import { conversationService } from '../conversationService';

vi.mock('../../db', () => ({
  db: { messages: { update: vi.fn() } },
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
