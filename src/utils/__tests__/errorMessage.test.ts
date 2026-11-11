import { describe, expect, it } from 'vitest';

import { errorMessageOr, extractErrorMessage } from '../errorMessage';

describe('extractErrorMessage', () => {
  it('reads a JSON string', () => {
    expect(extractErrorMessage('{"error":{"message":"Bad key"}}')).toBe('Bad key');
  });

  it('prefers the response body of an Error over its message', () => {
    const error = Object.assign(new Error('No output generated.'), {
      responseBody: '{"message":"Model not found"}',
    });
    expect(extractErrorMessage(error)).toBe('Model not found');
  });

  it('skips generic placeholders', () => {
    expect(extractErrorMessage('Unknown error')).toBeNull();
    expect(extractErrorMessage(new Error('No output generated.'))).toBeNull();
  });

  it('does not loop on a cyclic object', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.cause = cyclic;
    expect(extractErrorMessage(cyclic)).toBeNull();
  });

  it('uses the fallback when there is no message', () => {
    expect(errorMessageOr({}, 'Request failed')).toBe('Request failed');
    expect(errorMessageOr(new Error('Timeout'), 'Request failed')).toBe('Timeout');
  });
});
