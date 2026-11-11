import { describe, expect, it } from 'vitest';

import { getMediaTypeFromFormat, lookupFormat, lookupMediaType } from '../mediaTypes';

describe('mediaTypes', () => {
  it('maps a format to its media type in both letter cases', () => {
    expect(lookupMediaType('pdf')).toBe('application/pdf');
    expect(lookupMediaType('PNG')).toBe('image/png');
  });

  it('returns undefined for a format it does not know', () => {
    expect(lookupMediaType('exe')).toBeUndefined();
  });

  it('falls back to a binary media type', () => {
    expect(getMediaTypeFromFormat('exe')).toBe('application/octet-stream');
  });

  it('maps a media type back to one format', () => {
    expect(lookupFormat('image/jpeg')).toBe('jpg');
    expect(lookupFormat('text/markdown')).toBe('md');
    expect(lookupFormat('application/zip')).toBeUndefined();
  });
});
