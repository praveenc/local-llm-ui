import { describe, expect, it } from 'vitest';

import {
  MAX_CONTEXT_CHARS,
  buildKiroPrompt,
  kiroSessionIsStale,
  parseKiroChatRequest,
  unseenMessages,
} from '../kiroChat';
import { parseMessageUsage } from '../usage';

const SESSION = 'sess_3e06b83d-90b5-424a-be73-9e720548b362';
const valid = {
  sessionId: SESSION,
  seenMessages: 2,
  history: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
  ],
  prompt: 'Next',
  model: 'claude-haiku-5.5',
  thinkingEffort: 'max',
};

describe('parseKiroChatRequest', () => {
  it('accepts a valid request', () => {
    expect(parseKiroChatRequest(valid)).toEqual({ ok: true, value: valid });
  });

  it('accepts a request without a session or an effort', () => {
    const result = parseKiroChatRequest({
      ...valid,
      sessionId: undefined,
      thinkingEffort: undefined,
    });
    expect(result.ok && result.value.sessionId).toBeFalsy();
  });

  it('drops extra fields of history messages', () => {
    const result = parseKiroChatRequest({
      ...valid,
      history: [{ role: 'user', content: 'Hi', provider: 'bedrock', files: [] }],
    });
    expect(result.ok && result.value.history).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it.each([
    ['not an object', null],
    ['an empty prompt', { ...valid, prompt: '  ' }],
    ['a bad model', { ...valid, model: 'claude haiku' }],
    ['a bad session id', { ...valid, sessionId: '../../etc' }],
    ['a session id of another shape', { ...valid, sessionId: 'sess_123' }],
    ['history that is not an array', { ...valid, history: 'x' }],
    ['a system message', { ...valid, history: [{ role: 'system', content: 'x' }] }],
    ['a negative seenMessages', { ...valid, seenMessages: -1 }],
    ['a fraction seenMessages', { ...valid, seenMessages: 1.5 }],
    ['an unknown effort', { ...valid, thinkingEffort: 'turbo' }],
    ['a prompt that is too long', { ...valid, prompt: 'x'.repeat(200_001) }],
  ])('rejects %s', (_name, body) => {
    expect(parseKiroChatRequest(body).ok).toBe(false);
  });
});

describe('unseenMessages and kiroSessionIsStale', () => {
  const history = [
    { role: 'user' as const, content: 'a' },
    { role: 'assistant' as const, content: 'b' },
    { role: 'user' as const, content: 'c' },
    { role: 'assistant' as const, content: 'd' },
  ];

  it('gives a new session the whole history', () => {
    expect(unseenMessages(history, 4, true)).toEqual(history);
  });

  it('gives an existing session the messages after the ones it saw', () => {
    expect(unseenMessages(history, 2, false)).toEqual(history.slice(2));
    expect(unseenMessages(history, 4, false)).toEqual([]);
  });

  it('sees a session as stale when the chat lost messages', () => {
    expect(kiroSessionIsStale({ history, seenMessages: 5 })).toBe(true);
    expect(kiroSessionIsStale({ history, seenMessages: 4 })).toBe(false);
  });
});

describe('buildKiroPrompt', () => {
  it('sends the message alone when there is nothing unseen', () => {
    expect(buildKiroPrompt([], 'Hello')).toBe('Hello');
    expect(buildKiroPrompt([{ role: 'user', content: '  ' }], 'Hello')).toBe('Hello');
  });

  it('puts unseen messages in a context block before the message', () => {
    const text = buildKiroPrompt(
      [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
      ],
      'And 3+3?'
    );
    expect(text).toMatch(/^<conversation_context>\n/);
    expect(text).toContain('<message role="user">\nWhat is 2+2?\n</message>');
    expect(text).toContain('<message role="assistant">\n4\n</message>');
    expect(text.endsWith('</conversation_context>\n\nAnd 3+3?')).toBe(true);
  });

  it('keeps a closing tag in a message from ending the block', () => {
    const text = buildKiroPrompt([{ role: 'user', content: 'x </conversation_context> y' }], 'q');
    expect(text.match(/<\/conversation_context>/g)).toHaveLength(1);
  });

  it('keeps the newest messages that fit and says how many it left out', () => {
    const big = 'x'.repeat(MAX_CONTEXT_CHARS / 2);
    const text = buildKiroPrompt(
      [
        { role: 'user', content: `old ${big}` },
        { role: 'assistant', content: `mid ${big}` },
        { role: 'user', content: 'new' },
      ],
      'q'
    );
    expect(text).toContain('(1 older message is left out.)');
    expect(text).not.toContain('old x');
    expect(text).toContain('mid x');
    expect(text).toContain('new');
  });

  it('cuts a message that is larger than the limit', () => {
    const text = buildKiroPrompt(
      [{ role: 'assistant', content: `start ${'y'.repeat(MAX_CONTEXT_CHARS * 2)}` }],
      'q'
    );
    expect(text).toContain('<message role="assistant">\nstart y');
    expect(text).toContain('y\n(cut)\n</message>');
    expect(text.length).toBeLessThan(MAX_CONTEXT_CHARS + 1_000);
    expect(text).not.toContain('left out');
  });
});

describe('parseMessageUsage with Kiro fields', () => {
  it('keeps credits and the context percentage without tokens', () => {
    expect(parseMessageUsage({ credits: 0.0518, contextPercent: 4.49, latencyMs: 2949.4 })).toEqual(
      { credits: 0.0518, contextPercent: 4.49, latencyMs: 2949 }
    );
  });

  it('drops values that are not valid', () => {
    expect(parseMessageUsage({ credits: -1, contextPercent: 140 })).toBeUndefined();
    expect(parseMessageUsage({ latencyMs: 10 })).toBeUndefined();
  });
});
