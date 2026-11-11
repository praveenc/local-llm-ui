/**
 * Find the message in an error payload.
 *
 * Shared by the browser and the server proxies. Provider errors come in many shapes: an Error
 * with a `responseBody`, a JSON string, or an object with `error`, `message`, `detail`, or
 * `data`. This walks them all and returns the first text that is not a generic placeholder.
 */

const GENERIC_ERRORS = new Set([
  'No output generated.',
  'No output generated. Check the stream for errors.',
  'Unknown error',
]);

function parseJsonSafely(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** The most specific message in `payload`, or null when it has none */
export function extractErrorMessage(payload: unknown): string | null {
  const visited = new Set<unknown>();

  const walk = (value: unknown): string | undefined => {
    if (value == null) return undefined;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;

      const parsed = parseJsonSafely(trimmed);
      if (parsed && parsed !== value) {
        return walk(parsed);
      }

      return GENERIC_ERRORS.has(trimmed) ? undefined : trimmed;
    }

    if (value instanceof Error) {
      const withFields = value as Error & {
        cause?: unknown;
        responseBody?: unknown;
      };

      return (
        walk(withFields.responseBody) ||
        walk(withFields.cause) ||
        (!GENERIC_ERRORS.has(value.message) ? value.message : undefined)
      );
    }

    if (typeof value === 'object') {
      if (visited.has(value)) return undefined;
      visited.add(value);

      const obj = value as Record<string, unknown>;

      return (
        walk(obj.error) ||
        walk(obj.message) ||
        walk(obj.responseBody) ||
        walk(obj.cause) ||
        walk(obj.details) ||
        walk(obj.detail) ||
        walk(obj.data)
      );
    }

    return undefined;
  };

  return walk(payload) || null;
}

/** As `extractErrorMessage`, with a fallback for payloads that have no message */
export function errorMessageOr(payload: unknown, fallback: string): string {
  return (
    extractErrorMessage(payload) ||
    (payload instanceof Error && payload.message ? payload.message : fallback)
  );
}
