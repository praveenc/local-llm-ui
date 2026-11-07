import { describe, expect, it } from 'vitest';

import { formatQuoteMessage, quoteTagsToMarkdown, toBlockquote } from '../quote';

describe('toBlockquote', () => {
  it('prefixes every line', () => {
    expect(toBlockquote('line one\nline two')).toBe('> line one\n> line two');
  });

  it('keeps blank lines inside the quote block', () => {
    expect(toBlockquote('a\n\nb')).toBe('> a\n>\n> b');
  });

  it('trims surrounding whitespace and CRLF line endings', () => {
    expect(toBlockquote('  \r\nhello  \r\nworld\r\n  ')).toBe('> hello\n> world');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(toBlockquote('  \n ')).toBe('');
  });
});

describe('formatQuoteMessage', () => {
  it('wraps the quote in <quote> tags and puts the response after one blank line', () => {
    expect(formatQuoteMessage('Remember: x\r\nline 2', '  Why only one?  ')).toBe(
      '<quote>\nRemember: x\nline 2\n</quote>\n\nWhy only one?'
    );
  });

  it('returns only the quote block when the response is empty', () => {
    expect(formatQuoteMessage('quote', '')).toBe('<quote>\nquote\n</quote>');
  });

  it('returns only the response when the quote is empty', () => {
    expect(formatQuoteMessage('  ', 'reply')).toBe('reply');
  });
});

describe('quoteTagsToMarkdown', () => {
  it('turns each <quote> block into a blockquote', () => {
    const text = formatQuoteMessage('a\nb', 'reply');
    expect(quoteTagsToMarkdown(text)).toBe('> a\n> b\n\nreply');
  });

  it('leaves text without quote tags unchanged', () => {
    expect(quoteTagsToMarkdown('plain <b>text</b>')).toBe('plain <b>text</b>');
  });
});
