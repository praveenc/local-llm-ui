import { describe, expect, it } from 'vitest';

import {
  isAllowedSignInUrl,
  isValidRegion,
  normalizeStartUrl,
  parseKiroLoginMethod,
  parseLoginLine,
  validateStartUrl,
} from '../kiroLogin';

describe('validateStartUrl', () => {
  it.each([
    'https://my-company.awsapps.com/start',
    'https://my-company.awsapps.com/start/',
    'https://d-1234567890.awsapps.com/start#/',
    'https://my-company.awsapps.cn/start',
    'https://ssoins-123.portal.us-east-1.app.aws',
    ' https://my-company.awsapps.com/start ',
  ])('accepts %s', (value) => {
    expect(validateStartUrl(value)).toBeUndefined();
  });

  it.each([
    '',
    'my-company.awsapps.com/start',
    'http://my-company.awsapps.com/start',
    'javascript:alert(1)',
    'ftp://my-company.awsapps.com',
    'https://user:pass@my-company.awsapps.com/start',
    'https://my-company.awsapps.com:8443/start',
    'https://awsapps.com/start',
    'https://awsapps.com.evil.example/start',
    'https://evilawsapps.com/start',
    'https://evil.example/start',
    'https://app.aws/start',
    'https://x.awsapps.com/st\nart',
    'https://x.awsapps.com/st\tart',
    'https://x.awsapps.com/start foo',
    'https://x.awsapps.com/\u202Estart',
    'https://x.awsapps.com/\u200Bstart',
    'https://x.awsapps.com/start\u0000',
  ])('rejects %j', (value) => {
    expect(validateStartUrl(value)).toBe(
      'Enter the start URL of your IAM Identity Center, for example https://my-company.awsapps.com/start'
    );
  });
});

describe('normalizeStartUrl', () => {
  it('returns the normalized form that goes to kiro-cli', () => {
    expect(normalizeStartUrl(' https://X.AWSAPPS.com/start ')).toBe('https://x.awsapps.com/start');
    expect(normalizeStartUrl('https://ssoins-1.portal.us-east-1.app.aws')).toBe(
      'https://ssoins-1.portal.us-east-1.app.aws/'
    );
  });

  it('turns fullwidth dots into the host that is checked', () => {
    expect(normalizeStartUrl('https://x\uFF0Eawsapps\uFF0Ecom/start')).toBe(
      'https://x.awsapps.com/start'
    );
  });

  it('rejects hidden characters before it parses', () => {
    expect(normalizeStartUrl('https://x.awsapps.com/st\nart')).toBeUndefined();
    expect(normalizeStartUrl('https://x.awsapps.com/\u202Estart')).toBeUndefined();
    expect(normalizeStartUrl('https://evil.example')).toBeUndefined();
  });
});

describe('isValidRegion', () => {
  it.each([
    'us-east-1',
    'eu-central-2',
    'us-gov-west-1',
    'cn-north-1',
    'us-iso-east-1',
    'us-isob-east-1',
    'eusc-de-east-1',
  ])('accepts %s', (value) => expect(isValidRegion(value)).toBe(true));
  it.each([
    '',
    'us-east',
    'US-EAST-1',
    'us-east-1 ',
    '--region',
    'us_east_1',
    'us-east-123',
    'abcde-east-1',
    'u-east-1',
  ])('rejects %j', (value) => expect(isValidRegion(value)).toBe(false));
});

describe('parseLoginLine', () => {
  it('reads the code', () => {
    expect(parseLoginLine('Code: FVVW-JCBH')).toEqual({ code: 'FVVW-JCBH' });
    expect(parseLoginLine('  Code:   ABCD-1234-EFGH  ')).toEqual({ code: 'ABCD-1234-EFGH' });
  });

  it('reads the URL', () => {
    expect(
      parseLoginLine('Open this URL: https://view.awsapps.com/start/#/device?user_code=FVVW-JCBH')
    ).toEqual({ url: 'https://view.awsapps.com/start/#/device?user_code=FVVW-JCBH' });
  });

  it('ignores other lines', () => {
    expect(parseLoginLine('')).toBeUndefined();
    expect(parseLoginLine('Confirm the following code in the browser')).toBeUndefined();
    expect(parseLoginLine('Code: abc')).toBeUndefined();
    expect(parseLoginLine('Code: FVVW')).toBeUndefined();
    expect(parseLoginLine('The Code: FVVW-JCBH')).toBeUndefined();
    expect(parseLoginLine('Open this URL: https://a.example b')).toBeUndefined();
    expect(parseLoginLine('▰▱▱ Logging in...')).toBeUndefined();
  });
});

describe('isAllowedSignInUrl', () => {
  it.each([
    'https://view.awsapps.com/start/#/device?user_code=ABCD-EFGH',
    'https://amzn.awsapps.com/start/#/device?user_code=ABCD-EFGH',
    'https://view.awsapps.cn/start',
  ])('allows %s', (url) => expect(isAllowedSignInUrl(url)).toBe(true));

  it.each([
    '',
    'not a url',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'file:///etc/passwd',
    'http://view.awsapps.com/start',
    'https://user@view.awsapps.com/start',
    'https://user:pass@view.awsapps.com/start',
    'https://view.awsapps.com:8443/start',
    'https://awsapps.com/start',
    'https://awsapps.com.evil.example/start',
    'https://evilawsapps.com/start',
    'https://view.awsapps.com.evil.example/start',
    'https://evil.example/?u=view.awsapps.com',
    'https://evil.example/@view.awsapps.com',
  ])('rejects %j', (url) => expect(isAllowedSignInUrl(url)).toBe(false));

  it('allows an app.aws host only when it is the host of the start URL', () => {
    const url = 'https://ssoins-123.portal.us-east-1.app.aws/#/device?user_code=ABCD-EFGH';
    expect(isAllowedSignInUrl(url)).toBe(false);
    expect(isAllowedSignInUrl(url, 'https://ssoins-123.portal.us-east-1.app.aws')).toBe(true);
    expect(isAllowedSignInUrl(url, 'https://ssoins-999.portal.us-east-1.app.aws')).toBe(false);
    expect(isAllowedSignInUrl(url, 'https://my-company.awsapps.com/start')).toBe(false);
  });

  it('allows the SSO OIDC device page of the Region, and only that host', () => {
    const start = 'https://my-company.awsapps.com/start';
    const url = 'https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH';
    expect(isAllowedSignInUrl(url)).toBe(false);
    expect(isAllowedSignInUrl(url, start)).toBe(false);
    expect(isAllowedSignInUrl(url, start, 'us-east-1')).toBe(true);
    expect(isAllowedSignInUrl(url, start, 'us-west-2')).toBe(false);
    expect(isAllowedSignInUrl(url, undefined, 'us-east-1')).toBe(false);
    expect(isAllowedSignInUrl(url, start, 'us-east-1.evil')).toBe(false);
    expect(
      isAllowedSignInUrl('https://device.sso.cn-north-1.amazonaws.com.cn/', start, 'cn-north-1')
    ).toBe(true);
    expect(
      isAllowedSignInUrl('https://device.sso.cn-north-1.amazonaws.com/', start, 'cn-north-1')
    ).toBe(false);
    for (const bad of [
      'https://x.device.sso.us-east-1.amazonaws.com/',
      'https://device.sso.us-east-1.amazonaws.com.evil.example/',
      'https://sso.us-east-1.amazonaws.com/',
      'http://device.sso.us-east-1.amazonaws.com/',
      'https://device.sso.us-east-1.amazonaws.com:444/',
    ]) {
      expect(isAllowedSignInUrl(bad, start, 'us-east-1')).toBe(false);
    }
  });

  it('ignores a start URL that is not valid', () => {
    expect(isAllowedSignInUrl('https://evil.example/x', 'https://evil.example/start')).toBe(false);
    expect(isAllowedSignInUrl('http://x.app.aws/x', 'http://x.app.aws')).toBe(false);
  });
});

describe('parseKiroLoginMethod', () => {
  it('accepts Builder ID', () => {
    expect(parseKiroLoginMethod({ method: 'builder-id' })).toEqual({
      ok: true,
      value: { method: 'builder-id' },
    });
  });

  it('accepts Identity Center and trims the values', () => {
    expect(
      parseKiroLoginMethod({
        method: 'identity-center',
        startUrl: ' https://x.awsapps.com/start ',
        region: ' us-east-1 ',
      })
    ).toEqual({
      ok: true,
      value: {
        method: 'identity-center',
        startUrl: 'https://x.awsapps.com/start',
        region: 'us-east-1',
      },
    });
  });

  it('sends the normalized start URL', () => {
    expect(
      parseKiroLoginMethod({
        method: 'identity-center',
        startUrl: 'https://x\uFF0Eawsapps\uFF0Ecom/start',
        region: 'eusc-de-east-1',
      })
    ).toEqual({
      ok: true,
      value: {
        method: 'identity-center',
        startUrl: 'https://x.awsapps.com/start',
        region: 'eusc-de-east-1',
      },
    });
  });

  it.each([
    'https://x.awsapps.com/st\nart',
    'https://x.awsapps.com/start foo',
    'https://x.awsapps.com/\u202Estart',
  ])('rejects the start URL %j', (startUrl) => {
    expect(
      parseKiroLoginMethod({ method: 'identity-center', startUrl, region: 'us-east-1' })
    ).toEqual({
      ok: false,
      error:
        'Enter the start URL of your IAM Identity Center, for example https://my-company.awsapps.com/start',
    });
  });

  it.each([
    null,
    'builder-id',
    [],
    {},
    { method: 'other' },
    { method: 'identity-center' },
    { method: 'identity-center', startUrl: 'https://evil.example', region: 'us-east-1' },
    { method: 'identity-center', startUrl: 'https://x.awsapps.com/start', region: '--help' },
    { method: 'identity-center', startUrl: 5, region: 'us-east-1' },
  ])('rejects %j', (value) => {
    expect(parseKiroLoginMethod(value).ok).toBe(false);
  });
});
