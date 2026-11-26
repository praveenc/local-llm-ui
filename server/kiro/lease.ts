/**
 * Kiro's error when another program holds the session (SessionHeldElsewhereError, code -32000):
 * the chat shows Kiro's own text (D15). The app keeps no lock of its own.
 */
import { AcpError } from '../acp/client.ts';

/** Kiro's text is cut to this size */
const MAX_LEASE_TEXT = 300;
const HELD_TEXT = /loaded in another program/i;

/** Kiro's own text for a session that another program holds; undefined for other errors */
export function kiroLeaseErrorText(error: unknown): string | undefined {
  if (!(error instanceof AcpError) || error.code !== -32000) return undefined;
  const data = error.data && typeof error.data === 'object' ? error.data : undefined;
  const type = (data as { errorType?: unknown } | undefined)?.errorType;
  if (type !== 'SessionHeldElsewhereError' && !HELD_TEXT.test(error.message)) return undefined;
  const text = error.message.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MAX_LEASE_TEXT) : undefined;
}
