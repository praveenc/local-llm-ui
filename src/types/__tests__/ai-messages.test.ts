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

  it('splits <think> tags into a reasoning part', () => {
    const ui = toUIMessage(dbMessage({ content: '<think>plan</think>\nanswer' }));
    expect(ui.parts).toEqual([
      { type: 'reasoning', reasoning: 'plan' },
      { type: 'text', text: 'answer' },
    ]);
  });
});
