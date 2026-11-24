import { describe, expect, it } from 'vitest';

import {
  isKiroReady,
  isSupportedKiroVersion,
  kiroAccountLabel,
  kiroDefaultProviderError,
  parseKiroVersion,
  parseKiroWhoami,
} from '../kiroStatus';

describe('parseKiroVersion', () => {
  it.each([
    ['kiro-cli 3.5.0\n', '3.5.0'],
    ['kiro-cli 2.37.1', '2.37.1'],
    ['kiro-cli 3.6.0-beta.1\n', '3.6.0-beta.1'],
    ['warning: x\nkiro-cli 3.4.0\n', '3.4.0'],
    ['kiro 3.5.0', undefined],
    ['', undefined],
  ])('%j → %s', (output, expected) => {
    expect(parseKiroVersion(output)).toBe(expected);
  });
});

describe('isSupportedKiroVersion', () => {
  it.each([
    ['3.0.0', true],
    ['3.5.0', true],
    ['4.0.0', true],
    ['2.37.1', false],
    ['x.y.z', false],
  ])('%s → %s', (version, expected) => {
    expect(isSupportedKiroVersion(version)).toBe(expected);
  });
});

describe('parseKiroWhoami', () => {
  it('reads an IAM Identity Center account, with text after the JSON', () => {
    const output =
      '{"accountType":"IamIdentityCenter","startUrl":"https://x.awsapps.com/start","region":"us-east-1","email":"you@example.com"}\n\nProfile:\nqdev\n';
    expect(parseKiroWhoami(output)).toEqual({ type: 'identity-center', email: 'you@example.com' });
  });

  it('reads a Builder ID account', () => {
    expect(parseKiroWhoami('{"accountType":"BuilderId","email":"a@b.c"}')).toEqual({
      type: 'builder-id',
      email: 'a@b.c',
    });
  });

  it('reads an API key login, which has no email', () => {
    expect(parseKiroWhoami('{"accountType":"ApiKey","email":null}\n')).toEqual({ type: 'api-key' });
  });

  it('keeps an account type that it does not know', () => {
    expect(parseKiroWhoami('{"accountType":"Social"}')).toEqual({ type: 'other' });
  });

  it('returns null when signed out', () => {
    expect(parseKiroWhoami('{"account":null}\n')).toBeNull();
  });

  it.each(['Not logged in\n', '', '{"x":1}', '{broken', '[1]', 'null'])(
    'returns undefined for %j',
    (output) => {
      expect(parseKiroWhoami(output)).toBeUndefined();
    }
  );
});

describe('isKiroReady', () => {
  it('is true only when signed in', () => {
    expect(
      isKiroReady({
        state: 'signed-in',
        path: '~/.local/bin/kiro-cli',
        version: '3.5.0',
        account: { type: 'api-key' },
      })
    ).toBe(true);
    expect(isKiroReady({ state: 'signed-out', path: 'k', version: '3.5.0' })).toBe(false);
    expect(isKiroReady({ state: 'not-installed' })).toBe(false);
    expect(isKiroReady(undefined)).toBe(false);
  });
});

describe('kiroAccountLabel', () => {
  it('names each account type', () => {
    expect(kiroAccountLabel('builder-id')).toBe('AWS Builder ID');
    expect(kiroAccountLabel('identity-center')).toBe('IAM Identity Center');
    expect(kiroAccountLabel('api-key')).toBe('API key');
    expect(kiroAccountLabel('other')).toBe('Kiro account');
  });
});

describe('kiroDefaultProviderError', () => {
  it('allows Kiro when it is ready or the status is not known yet', () => {
    expect(kiroDefaultProviderError(undefined)).toBeUndefined();
    expect(
      kiroDefaultProviderError({
        state: 'signed-in',
        path: 'k',
        version: '3.5.0',
        account: { type: 'api-key' },
      })
    ).toBeUndefined();
  });

  it('says what to do in each other state', () => {
    expect(kiroDefaultProviderError({ state: 'signed-out', path: 'k', version: '3.5.0' })).toBe(
      'Not saved. Sign in to Kiro, or choose a different default provider.'
    );
    expect(
      kiroDefaultProviderError({ state: 'unsupported', path: 'k', version: '2.37.1' })
    ).toMatch(/Update Kiro CLI to version 3/);
    expect(kiroDefaultProviderError({ state: 'not-installed' })).toMatch(/not installed/);
    expect(kiroDefaultProviderError({ state: 'error', path: 'k', message: 'x' })).toMatch(
      /does not run/
    );
  });
});
