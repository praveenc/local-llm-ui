import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../db';
import type { Provider } from '../../db';
import { conversationService } from '../conversationService';

const add = (
  conversationId: string,
  sequence: number,
  role: 'user' | 'assistant',
  provider: Provider,
  modelId: string,
  usage?: { inputTokens: number; outputTokens: number }
) =>
  conversationService.addMessage({
    conversationId,
    role,
    content: `${role} ${sequence}`,
    sequence,
    createdAt: new Date(),
    provider,
    modelId,
    modelName: modelId,
    ...(usage && { usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens } }),
  });

beforeEach(async () => {
  await db.conversations.clear();
  await db.messages.clear();
});

describe('conversationService totals after a delete', () => {
  it('recomputes the count, the tokens, the providers, and the models from the rows left', async () => {
    const { id } = await conversationService.create();
    await add(id, 1, 'user', 'bedrock', 'model-x');
    await add(id, 2, 'assistant', 'bedrock', 'model-x', { inputTokens: 100, outputTokens: 50 });
    await add(id, 3, 'user', 'anthropic', 'model-y');
    await add(id, 4, 'assistant', 'anthropic', 'model-y', { inputTokens: 10, outputTokens: 5 });
    expect(await conversationService.get(id)).toMatchObject({
      messageCount: 4,
      totalInputTokens: 110,
      totalOutputTokens: 55,
      providers: ['bedrock', 'anthropic'],
      models: ['model-x', 'model-y'],
    });

    expect(await conversationService.deleteMessagesFromSequence(id, 3)).toBe(2);

    expect(await conversationService.get(id)).toMatchObject({
      messageCount: 2,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      providers: ['bedrock'],
      models: ['model-x'],
    });
  });

  it('gives a fork the same totals as its copied messages', async () => {
    const { id } = await conversationService.create();
    await add(id, 1, 'user', 'bedrock', 'model-x');
    await add(id, 2, 'assistant', 'bedrock', 'model-x', { inputTokens: 7, outputTokens: 3 });
    await add(id, 3, 'user', 'groq', 'model-z');
    const fork = await conversationService.fork(id, 2);
    expect(fork).toMatchObject({
      messageCount: 2,
      totalInputTokens: 7,
      totalOutputTokens: 3,
      providers: ['bedrock'],
      models: ['model-x'],
    });
  });
});

describe('conversationService.setMessageFeedback on the database', () => {
  it('fails for a message with no row', async () => {
    await expect(conversationService.setMessageFeedback('gone', 'helpful')).rejects.toThrow(
      'Message not found'
    );
  });

  it('saves, and saves the same value again without an error', async () => {
    const { id } = await conversationService.create();
    const message = await add(id, 1, 'assistant', 'bedrock', 'model-x');
    await conversationService.setMessageFeedback(message.id, 'helpful');
    // Dexie counts 0 changed rows here; the row exists, so it is not a failure
    await conversationService.setMessageFeedback(message.id, 'helpful');
    expect((await db.messages.get(message.id))?.feedback).toBe('helpful');
  });
});
