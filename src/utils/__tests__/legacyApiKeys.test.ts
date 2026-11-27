import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateLegacyApiKeys } from '../legacyApiKeys';
import { loadPreferences } from '../preferences';

const PREFS = 'local-llm-ui-preferences';
// Placeholder values; each one is unique so that the output check can find it
const LEGACY_GROQ = 'gsk-legacy-value-1';
const LEGACY_OPENROUTER = 'or-legacy-value-2';
const PREFS_GROQ = 'gsk-prefs-value-3';

const stored = () => JSON.parse(localStorage.getItem(PREFS) ?? 'null') as Record<string, unknown>;

describe('migrateLegacyApiKeys', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // No key value in any console output, in every case
    const output = [warn, error, log]
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call.map(String).join(' '))
      .join('\n');
    for (const value of [LEGACY_GROQ, LEGACY_OPENROUTER, PREFS_GROQ]) {
      expect(output).not.toContain(value);
    }
    vi.restoreAllMocks();
  });

  it('moves a key that is only in the legacy entry, trimmed, and removes the entry', () => {
    localStorage.setItem(PREFS, JSON.stringify({ colorTheme: 'cobaltz', groqApiKey: '' }));
    localStorage.setItem('GROQ_API_KEY', `  ${LEGACY_GROQ}  `);
    localStorage.setItem('OPENROUTER_API_KEY', LEGACY_OPENROUTER);

    migrateLegacyApiKeys();

    expect(stored()).toEqual({
      colorTheme: 'cobaltz',
      groqApiKey: LEGACY_GROQ,
      openrouterApiKey: LEGACY_OPENROUTER,
    });
    expect(localStorage.getItem('GROQ_API_KEY')).toBeNull();
    expect(localStorage.getItem('OPENROUTER_API_KEY')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('starts from an empty object when there are no preferences', () => {
    localStorage.setItem('ANTHROPIC_API_KEY', 'sk-ant-legacy');

    migrateLegacyApiKeys();

    expect(stored()).toEqual({ anthropicApiKey: 'sk-ant-legacy' });
    expect(localStorage.getItem('ANTHROPIC_API_KEY')).toBeNull();
  });

  it('removes the legacy entry when both values are equal, with no write', () => {
    localStorage.setItem(PREFS, JSON.stringify({ groqApiKey: LEGACY_GROQ }));
    localStorage.setItem('GROQ_API_KEY', ` ${LEGACY_GROQ}`);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    migrateLegacyApiKeys();

    expect(setItem).not.toHaveBeenCalled();
    expect(stored()).toEqual({ groqApiKey: LEGACY_GROQ });
    expect(localStorage.getItem('GROQ_API_KEY')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the preferences value when the two differ, and warns with the key name only', () => {
    localStorage.setItem(PREFS, JSON.stringify({ groqApiKey: PREFS_GROQ }));
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);

    migrateLegacyApiKeys();

    expect(stored()).toEqual({ groqApiKey: PREFS_GROQ });
    expect(localStorage.getItem('GROQ_API_KEY')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('GROQ_API_KEY');
  });

  it('removes an empty legacy entry and moves nothing', () => {
    localStorage.setItem('CEREBRAS_API_KEY', '   ');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    migrateLegacyApiKeys();

    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREFS)).toBeNull();
    expect(localStorage.getItem('CEREBRAS_API_KEY')).toBeNull();
  });

  it.each([
    ['does not parse', '{not json'],
    ['is not an object', '"text"'],
    ['is an array', '[1,2]'],
    ['is null', 'null'],
  ])('never writes the preferences and keeps the legacy keys when the blob %s', (_label, raw) => {
    localStorage.setItem(PREFS, raw);
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    migrateLegacyApiKeys();

    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREFS)).toBe(raw);
    expect(localStorage.getItem('GROQ_API_KEY')).toBe(LEGACY_GROQ);
  });

  it('keeps the legacy keys when the write throws', () => {
    localStorage.setItem(PREFS, JSON.stringify({ colorTheme: 'neutral' }));
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);
    localStorage.setItem('ANTHROPIC_API_KEY', 'sk-ant-legacy');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    migrateLegacyApiKeys();

    expect(removeItem).not.toHaveBeenCalled();
    expect(localStorage.getItem('GROQ_API_KEY')).toBe(LEGACY_GROQ);
    expect(localStorage.getItem('ANTHROPIC_API_KEY')).toBe('sk-ant-legacy');
    expect(stored()).toEqual({ colorTheme: 'neutral' });
  });

  it('keeps the legacy keys when the read-back differs', () => {
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);
    // A write that does not keep the value, as storage that drops writes
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    migrateLegacyApiKeys();

    // Only the blob that this run made is removed again, never a legacy entry
    expect(removeItem.mock.calls).toEqual([[PREFS]]);
    expect(localStorage.getItem('GROQ_API_KEY')).toBe(LEGACY_GROQ);
  });

  it('restores the blob when the read-back differs, so the next load cannot drop the legacy key', () => {
    // Storage that changes the written value: the field holds a value that is not the legacy one
    const data = new Map<string, string>([['ANTHROPIC_API_KEY', 'AAA-legacy']]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value.replace('AAA', 'BBB')),
      removeItem: (key: string) => void data.delete(key),
    };

    migrateLegacyApiKeys(storage);

    expect(data.get('ANTHROPIC_API_KEY')).toBe('AAA-legacy');
    expect(data.has(PREFS)).toBe(false);

    // The next load finds the same state and still keeps the legacy key
    migrateLegacyApiKeys(storage);
    expect(data.get('ANTHROPIC_API_KEY')).toBe('AAA-legacy');
  });

  it('restores the earlier blob, not an empty one, when the read-back differs', () => {
    const before = JSON.stringify({ colorTheme: 'neutral' });
    const data = new Map<string, string>([
      [PREFS, before],
      ['GROQ_API_KEY', LEGACY_GROQ],
    ]);
    let writes = 0;
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      // The first write is changed on the way; later writes are kept as they are
      setItem: (key: string, value: string) =>
        void data.set(key, writes++ === 0 ? value.replace(LEGACY_GROQ, 'other') : value),
      removeItem: (key: string) => void data.delete(key),
    };

    migrateLegacyApiKeys(storage);

    expect(data.get(PREFS)).toBe(before);
    expect(data.get('GROQ_API_KEY')).toBe(LEGACY_GROQ);
  });

  it('does not report a removal when a write in the same run fails', () => {
    localStorage.setItem(PREFS, JSON.stringify({ groqApiKey: PREFS_GROQ }));
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);
    localStorage.setItem('ANTHROPIC_API_KEY', 'sk-ant-legacy');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    migrateLegacyApiKeys();

    expect(localStorage.getItem('GROQ_API_KEY')).toBe(LEGACY_GROQ);
    const messages: string[] = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages.some((message) => message.includes('removed'))).toBe(false);
  });

  it('does not throw when the browser blocks localStorage', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      expect(() => migrateLegacyApiKeys()).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });

  it('moves the key to where loadPreferences reads it', () => {
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);

    migrateLegacyApiKeys();

    expect(loadPreferences().groqApiKey).toBe(LEGACY_GROQ);
  });

  it('changes nothing on a second call', () => {
    localStorage.setItem(PREFS, JSON.stringify({ groqApiKey: '' }));
    localStorage.setItem('GROQ_API_KEY', LEGACY_GROQ);
    migrateLegacyApiKeys();
    const after = localStorage.getItem(PREFS);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    migrateLegacyApiKeys();

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    // Only the four legacy names are read; the preferences are not
    expect(getItem).not.toHaveBeenCalledWith(PREFS);
    expect(localStorage.getItem(PREFS)).toBe(after);
  });

  it('uses the storage that it gets', () => {
    const data = new Map<string, string>([['OPENROUTER_API_KEY', LEGACY_OPENROUTER]]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };

    migrateLegacyApiKeys(storage);

    expect(JSON.parse(data.get(PREFS) ?? 'null')).toEqual({ openrouterApiKey: LEGACY_OPENROUTER });
    expect(data.has('OPENROUTER_API_KEY')).toBe(false);
    expect(localStorage.getItem(PREFS)).toBeNull();
  });
});
