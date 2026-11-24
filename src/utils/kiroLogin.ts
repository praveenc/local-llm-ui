/**
 * Kiro CLI sign-in: the methods, the events that POST /api/kiro/login streams, and the checks
 * for what the browser and the server accept. Shared by both, so no DOM or Node imports.
 */
import type { KiroStatus } from './kiroStatus';

export type KiroLoginMethod =
  { method: 'builder-id' } | { method: 'identity-center'; startUrl: string; region: string };

/** One event of the sign-in stream. `done` and `error` end it. */
export type KiroLoginEvent =
  | { state: 'started' }
  | { state: 'code'; code: string; url: string }
  | { state: 'done'; status: KiroStatus }
  | { state: 'error'; message: string };

export const START_URL_ERROR =
  'Enter the start URL of your IAM Identity Center, for example https://my-company.awsapps.com/start';
export const REGION_ERROR = 'Enter a Region, for example us-east-1';

/** Hosts of the sign-in pages that every account can use */
const AWSAPPS_SUFFIXES = ['.awsapps.com', '.awsapps.cn'];
/** Hosts that an IAM Identity Center start URL can have (the new portal URLs use app.aws) */
const START_URL_SUFFIXES = [...AWSAPPS_SUFFIXES, '.app.aws'];

function parseHttpsUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
  return url;
}

const hasSuffix = (host: string, suffixes: string[]) =>
  suffixes.some((suffix) => host.endsWith(suffix));

/** An error message when the value is not the start URL of an IAM Identity Center, else undefined */
export function validateStartUrl(value: string): string | undefined {
  const url = parseHttpsUrl(value.trim());
  if (!url || !hasSuffix(url.hostname, START_URL_SUFFIXES)) return START_URL_ERROR;
  return undefined;
}

/** True for an AWS Region name such as us-east-1, us-gov-west-1, or cn-north-1 */
export function isValidRegion(value: string): boolean {
  return /^[a-z]{2}(-gov|-iso[a-z]?)?-[a-z]+-\d{1,2}$/.test(value);
}

/** An error message when the Region is not valid, else undefined */
export function validateRegion(value: string): string | undefined {
  return isValidRegion(value.trim()) ? undefined : REGION_ERROR;
}

/**
 * The code or the URL in one line of `kiro-cli login` output (ANSI codes already removed).
 * Returns undefined for every other line.
 */
export function parseLoginLine(line: string): { code: string } | { url: string } | undefined {
  const code = /^\s*Code:\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\s*$/.exec(line);
  if (code) return { code: code[1] };
  const url = /^\s*Open this URL:\s*(\S+)\s*$/.exec(line);
  if (url) return { url: url[1] };
  return undefined;
}

/**
 * True when the app may open this sign-in page: https, no credentials, and a host on awsapps.com
 * or awsapps.cn, or the host of the start URL that the user gave. A host such as
 * awsapps.com.evil.example or evilawsapps.com does not match.
 */
export function isAllowedSignInUrl(url: string, startUrl?: string): boolean {
  const parsed = parseHttpsUrl(url);
  if (!parsed) return false;
  if (hasSuffix(parsed.hostname, AWSAPPS_SUFFIXES)) return true;
  if (!startUrl || validateStartUrl(startUrl)) return false;
  const start = parseHttpsUrl(startUrl.trim());
  return !!start && start.host === parsed.host;
}

/** Checks the body of POST /api/kiro/login. The values are trimmed. */
export function parseKiroLoginMethod(
  value: unknown
): { ok: true; value: KiroLoginMethod } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Send the sign-in method as a JSON object' };
  }
  const record = value as Record<string, unknown>;
  if (record.method === 'builder-id') return { ok: true, value: { method: 'builder-id' } };
  if (record.method === 'identity-center') {
    const startUrl = typeof record.startUrl === 'string' ? record.startUrl.trim() : '';
    const region = typeof record.region === 'string' ? record.region.trim() : '';
    const startUrlError = validateStartUrl(startUrl);
    if (startUrlError) return { ok: false, error: startUrlError };
    const regionError = validateRegion(region);
    if (regionError) return { ok: false, error: regionError };
    return { ok: true, value: { method: 'identity-center', startUrl, region } };
  }
  return { ok: false, error: 'The sign-in method must be builder-id or identity-center' };
}
