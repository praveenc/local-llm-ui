/**
 * Kiro CLI sign-in: the methods, the events that POST /api/kiro/login streams, and the checks
 * for what the browser and the server accept. Shared by both, so no DOM or Node imports.
 */
import type { KiroStatus } from './kiroStatus';

export type KiroLoginMethod =
  { method: 'builder-id' } | { method: 'identity-center'; startUrl: string; region: string };

/** One event of the sign-in stream. `done` and `error` end it. */
export type KiroLoginEvent =
  /** `runId` names this sign-in, for POST /api/kiro/login/cancel */
  | { state: 'started'; runId: string }
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

/**
 * Whitespace, control, and format characters (such as the right-to-left override). URL parsing
 * removes or encodes them, so the string that kiro-cli gets would not be the one that was checked.
 */
const HIDDEN_CHARACTERS = /[\s\p{Cc}\p{Cf}]/u;

/**
 * The start URL in its normalized form (`new URL(value).href`), the form that goes to kiro-cli
 * and to the saved preference. Undefined when it is not the start URL of an IAM Identity Center.
 */
export function normalizeStartUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (HIDDEN_CHARACTERS.test(trimmed)) return undefined;
  const url = parseHttpsUrl(trimmed);
  if (!url || !hasSuffix(url.hostname, START_URL_SUFFIXES)) return undefined;
  return url.href;
}

/** An error message when the value is not the start URL of an IAM Identity Center, else undefined */
export function validateStartUrl(value: string): string | undefined {
  return normalizeStartUrl(value) ? undefined : START_URL_ERROR;
}

/**
 * True for an AWS Region name such as us-east-1, us-gov-west-1, cn-north-1, or eusc-de-east-1
 * (AWS European Sovereign Cloud)
 */
export function isValidRegion(value: string): boolean {
  return /^[a-z]{2,4}(-gov|-iso[a-z]?|-[a-z]{2})?-[a-z]+-\d{1,2}$/.test(value);
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

/** The SSO OIDC device page of a Region: device.sso.<region>.amazonaws.com(.cn) */
function deviceHost(region: string): string {
  return `device.sso.${region}.amazonaws.com${region.startsWith('cn-') ? '.cn' : ''}`;
}

/**
 * True when the app may open this sign-in page: https, no credentials, and a host on awsapps.com
 * or awsapps.cn. For IAM Identity Center (`startUrl` and `region` given) also the exact host of
 * the start URL and the exact device page host of the Region. A host such as
 * awsapps.com.evil.example or evilawsapps.com does not match.
 */
export function isAllowedSignInUrl(url: string, startUrl?: string, region?: string): boolean {
  const parsed = parseHttpsUrl(url);
  if (!parsed) return false;
  if (hasSuffix(parsed.hostname, AWSAPPS_SUFFIXES)) return true;
  const normalized = startUrl === undefined ? undefined : normalizeStartUrl(startUrl);
  if (!normalized) return false;
  if (new URL(normalized).host === parsed.host) return true;
  return region !== undefined && isValidRegion(region) && parsed.host === deviceHost(region);
}

/** Checks the body of POST /api/kiro/login. The values are trimmed; the start URL is normalized. */
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
    const normalized = normalizeStartUrl(startUrl);
    if (!normalized) return { ok: false, error: START_URL_ERROR };
    const regionError = validateRegion(region);
    if (regionError) return { ok: false, error: regionError };
    return { ok: true, value: { method: 'identity-center', startUrl: normalized, region } };
  }
  return { ok: false, error: 'The sign-in method must be builder-id or identity-center' };
}
