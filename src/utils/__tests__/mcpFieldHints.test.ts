import { describe, expect, it } from 'vitest';

import { hasOuterQuotes } from '../mcpFieldHints';

describe('hasOuterQuotes', () => {
  it('is true for text in double or single quotes', () => {
    expect(hasOuterQuotes('"-y"')).toBe(true);
    expect(hasOuterQuotes("'x'")).toBe(true);
    expect(hasOuterQuotes('""')).toBe(true);
  });

  it('ignores white space around the quotes', () => {
    expect(hasOuterQuotes('  "a b"  ')).toBe(true);
  });

  it('is false for text with no outer quotes', () => {
    expect(hasOuterQuotes('-y')).toBe(false);
    expect(hasOuterQuotes('')).toBe(false);
    expect(hasOuterQuotes('   ')).toBe(false);
  });

  it('is false for one quote character', () => {
    expect(hasOuterQuotes('"')).toBe(false);
    expect(hasOuterQuotes("'")).toBe(false);
  });

  it('is false when only the inside has quotes', () => {
    expect(hasOuterQuotes('a"b"')).toBe(false);
    expect(hasOuterQuotes('"a"b')).toBe(false);
  });

  it('is false when the two quotes differ', () => {
    expect(hasOuterQuotes('"a\'')).toBe(false);
    expect(hasOuterQuotes('\'a"')).toBe(false);
  });
});
