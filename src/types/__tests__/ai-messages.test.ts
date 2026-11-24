import { describe, expect, it } from 'vitest';

import type { Message } from '../../db/types';
import { toUIMessage } from '../ai-messages';

const dbMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c1',
  role: 'assistant',
  content: 'Hello',
  sequence: 1,
  createdAt: new Date('2026-01-01'),
  provider: 'ollama',
  modelId: 'llama3',
  modelName: 'Llama 3',
  ...overrides,
});

describe('toUIMessage', () => {
  it('carries the stored feedback to the UI message', () => {
    expect(toUIMessage(dbMessage({ feedback: 'helpful' })).feedback).toBe('helpful');
    expect(toUIMessage(dbMessage({ feedback: 'not-helpful' })).feedback).toBe('not-helpful');
  });

  it('leaves feedback out when the message has none', () => {
    expect(toUIMessage(dbMessage())).not.toHaveProperty('feedback');
  });

  it('restores the usage and the model of a stored reply, so a reopened chat keeps them', () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, latencyMs: 900 };
    const ui = toUIMessage(dbMessage({ usage }));
    expect(ui.usage).toEqual(usage);
    expect(ui.model).toEqual({ provider: 'ollama', id: 'llama3' });
    expect(toUIMessage(dbMessage({ role: 'user' }))).not.toHaveProperty('model');
  });

  it('splits <think> tags into a reasoning part', () => {
    const ui = toUIMessage(dbMessage({ content: '<think>plan</think>\nanswer' }));
    expect(ui.parts).toEqual([
      { type: 'reasoning', reasoning: 'plan' },
      { type: 'text', text: 'answer' },
    ]);
  });
});
