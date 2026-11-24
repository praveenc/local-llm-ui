import { describe, expect, it } from 'vitest';

import { normalizeTitle } from '../conversationTitle';

describe('normalizeTitle', () => {
  it('keeps a plain title', () => {
    expect(normalizeTitle('Trip plan')).toBe('Trip plan');
  });

  it('trims the ends', () => {
    expect(normalizeTitle('   Trip plan \t')).toBe('Trip plan');
  });

  it('collapses runs of white space and line breaks into one space', () => {
    expect(normalizeTitle('Trip   plan\n\nfor  \t May')).toBe('Trip plan for May');
  });

  it('returns null for empty or white-space-only text', () => {
    expect(normalizeTitle('')).toBeNull();
    expect(normalizeTitle(' \n\t  ')).toBeNull();
  });

  it('keeps non-Latin text', () => {
    expect(normalizeTitle('  日本語　の　題名 ')).toBe('日本語 の 題名');
  });
});
