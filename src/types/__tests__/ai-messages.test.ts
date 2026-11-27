import { describe, expect, it } from 'vitest';

import type { Message } from '../../db/types';
import {
  base64Size,
  base64ToBytes,
  bytesToBase64,
  toUIMessage,
  toUIMessages,
} from '../ai-messages';

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
    expect(ui.model).toEqual({ provider: 'ollama', id: 'llama3', name: 'Llama 3' });
    expect(toUIMessage(dbMessage({ role: 'user' }))).not.toHaveProperty('model');
  });

  it('restores stored tool calls between the thinking and the answer, with the thinking time', () => {
    const ui = toUIMessage(
      dbMessage({
        content: '<think>plan</think>\nanswer',
        reasoningMs: 4200,
        toolCalls: [
          { toolCallId: 'c1', toolName: 'webSearch', args: { query: 'q' }, status: 'complete' },
        ],
      })
    );
    expect(ui.parts.map((p) => p.type)).toEqual(['reasoning', 'tool-call', 'text']);
    expect(ui.parts[1]).toMatchObject({ type: 'tool-call', toolCallId: 'c1', status: 'complete' });
    expect(ui.reasoningMs).toBe(4200);
  });

  it('splits <think> tags into a reasoning part', () => {
    const ui = toUIMessage(dbMessage({ content: '<think>plan</think>\nanswer' }));
    expect(ui.parts).toEqual([
      { type: 'reasoning', reasoning: 'plan' },
      { type: 'text', text: 'answer' },
    ]);
  });
});

describe('toUIMessages files (#102)', () => {
  const attachment = { id: 'a1', name: 'photo.png', format: 'png', sizeBytes: 4, kept: true };

  it('gives each file part the stored bytes as base64', () => {
    const [message] = toUIMessages(
      [dbMessage({ role: 'user', attachments: [attachment] })],
      [
        {
          id: 'a1',
          messageId: 'm1',
          conversationId: 'c1',
          name: 'photo.png',
          mediaType: 'image/png',
          size: 4,
          data: new Uint8Array([137, 80, 78, 71]).buffer,
        },
      ]
    );
    expect(message.parts).toContainEqual({
      type: 'file',
      filename: 'photo.png',
      mediaType: 'image/png',
      size: 4,
      data: 'iVBORw==',
    });
  });

  it('marks a file not kept when its bytes are missing or were never stored', () => {
    const [missing, notKept] = toUIMessages([
      dbMessage({ role: 'user', attachments: [attachment] }),
      dbMessage({ id: 'm2', role: 'user', attachments: [{ ...attachment, kept: false }] }),
    ]);
    for (const message of [missing, notKept]) {
      expect(message.parts).toContainEqual({
        type: 'file',
        filename: 'photo.png',
        mediaType: 'image/png',
        size: 4,
        kept: false,
      });
    }
  });

  it('restores the count of earlier files that a reply did not send again', () => {
    expect(toUIMessage(dbMessage({ filesNotResent: 2 })).filesNotResent).toBe(2);
    expect(toUIMessage(dbMessage())).not.toHaveProperty('filesNotResent');
  });
});

describe('base64 helpers', () => {
  it('turns bytes into base64 and back, also for a large file', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const text = bytesToBase64(bytes.buffer);
    expect(base64Size(text)).toBe(bytes.length);
    expect([...new Uint8Array(base64ToBytes(text))]).toEqual([...bytes]);
  });
});
