/**
 * Kiro CLI status: what GET /api/kiro/status returns, and the functions that read kiro-cli
 * output. Shared by the browser and the server, so no DOM or Node imports.
 */

/** Lowest supported major version. Kiro CLI 2 has no v3 engine. */
export const MIN_KIRO_MAJOR_VERSION = 3;

export type KiroAccountType = 'builder-id' | 'identity-center' | 'api-key' | 'other';

export interface KiroAccount {
  type: KiroAccountType;
  /** Set for AWS Builder ID and IAM Identity Center; not for an API key */
  email?: string;
}

/**
 * The state of kiro-cli on the computer that runs the app. `path` is the binary that the app
 * runs, with the home folder written as `~`.
 */
export type KiroStatus =
  | { state: 'not-installed' }
  | { state: 'error'; path: string; message: string }
  | { state: 'unsupported'; path: string; version: string }
  | { state: 'signed-out'; path: string; version: string }
  | { state: 'signed-in'; path: string; version: string; account: KiroAccount };

export type KiroState = KiroStatus['state'];

/** The version in `kiro-cli --version` output ("kiro-cli 3.5.0"), or undefined */
export function parseKiroVersion(output: string): string | undefined {
  return /^kiro-cli (\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/m.exec(output)?.[1];
}

/** True for Kiro CLI 3 and later */
export function isSupportedKiroVersion(version: string): boolean {
  const major = Number(version.split('.')[0]);
  return Number.isInteger(major) && major >= MIN_KIRO_MAJOR_VERSION;
}

function accountType(value: unknown): KiroAccountType {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text === 'iamidentitycenter') return 'identity-center';
  if (text.includes('builder')) return 'builder-id';
  if (text === 'apikey') return 'api-key';
  return 'other';
}

/**
 * The account in `kiro-cli whoami -f json` output. kiro-cli prints the JSON on the first line,
 * then more text when signed in.
 *
 * - Signed in: `{"accountType":"IamIdentityCenter","startUrl":…,"region":…,"email":…}`
 * - API key: `{"accountType":"ApiKey","email":null}`
 * - Signed out: `{"account":null}` (exit code 1)
 *
 * Returns the account, null when signed out, or undefined when the output has no such JSON.
 */
export function parseKiroWhoami(output: string): KiroAccount | null | undefined {
  const line = output
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text.startsWith('{'));
  if (!line) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  if ('account' in record && record.account === null) return null;
  if (!('accountType' in record)) return undefined;
  const account: KiroAccount = { type: accountType(record.accountType) };
  if (typeof record.email === 'string' && record.email.trim()) account.email = record.email.trim();
  return account;
}

/** True when Kiro can be used: kiro-cli 3 is installed and signed in */
export function isKiroReady(status: KiroStatus | undefined): boolean {
  return status?.state === 'signed-in';
}

export function kiroAccountLabel(type: KiroAccountType): string {
  switch (type) {
    case 'builder-id':
      return 'AWS Builder ID';
    case 'identity-center':
      return 'IAM Identity Center';
    case 'api-key':
      return 'API key';
    default:
      return 'Kiro account';
  }
}

/**
 * Why Kiro cannot be the default provider, for the "Not saved" text in Preferences. Undefined
 * when Kiro is ready, or when the status is not known yet.
 */
export function kiroDefaultProviderError(status: KiroStatus | undefined): string | undefined {
  switch (status?.state) {
    case undefined:
    case 'signed-in':
      return undefined;
    case 'not-installed':
      return 'Not saved. Kiro CLI is not installed. Choose a different default provider.';
    case 'unsupported':
      return 'Not saved. Update Kiro CLI to version 3, or choose a different default provider.';
    case 'signed-out':
      return 'Not saved. Sign in to Kiro, or choose a different default provider.';
    case 'error':
      return 'Not saved. Kiro CLI does not run. Choose a different default provider.';
  }
}
