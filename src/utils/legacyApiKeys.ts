/**
 * Move the provider keys of older versions into the preferences.
 *
 * Older versions kept a second copy of four keys in their own localStorage entries. The
 * preferences object is now the only store of provider keys, so this moves a key that exists
 * only in the old entry, and removes the old entries. It runs once on each page load, before the
 * app reads the preferences. It needs no flag: after a run that succeeds the old entries are gone.
 *
 * Shared code: no DOM imports. The caller may pass a Storage; with none, it uses localStorage.
 * It never logs a key value.
 */

/** The same name as `STORAGE_KEY` in preferences.ts */
const PREFERENCES_KEY = 'local-llm-ui-preferences';

/** Old localStorage entry → field of the preferences object */
export const LEGACY_API_KEYS = [
  ['GROQ_API_KEY', 'groqApiKey'],
  ['CEREBRAS_API_KEY', 'cerebrasApiKey'],
  ['ANTHROPIC_API_KEY', 'anthropicApiKey'],
  ['OPENROUTER_API_KEY', 'openrouterApiKey'],
] as const;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function migrateLegacyApiKeys(storage?: StorageLike): void {
  try {
    // Inside the try: reading `localStorage` throws when the browser blocks site storage
    const store = storage ?? localStorage;
    const legacy = LEGACY_API_KEYS.map(([name, field]) => ({
      name,
      field,
      raw: store.getItem(name),
    }));
    // The common case after the first run: nothing to do, and the preferences are not read
    if (legacy.every((entry) => entry.raw === null)) return;

    const rawPreferences = store.getItem(PREFERENCES_KEY);
    let preferences: Record<string, unknown> = {};
    if (rawPreferences !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawPreferences);
      } catch {
        // A save of the defaults would erase this blob, so keep everything as it is
        return;
      }
      if (!isPlainObject(parsed)) return;
      preferences = parsed;
    }

    const toRemove: string[] = [];
    const differing: string[] = [];
    const moved: Array<{ field: string; value: string }> = [];
    for (const { name, field, raw } of legacy) {
      if (raw === null) continue;
      toRemove.push(name);
      const legacyValue = raw.trim();
      if (!legacyValue) continue;
      const current = trimmed(preferences[field]);
      if (!current) {
        preferences[field] = legacyValue;
        moved.push({ field, value: legacyValue });
      } else if (current !== legacyValue) {
        // The old entry was a copy of the preferences, and the chat already sends this value
        differing.push(name);
      }
    }

    if (moved.length > 0) {
      store.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      if (!readBackMatches(store, moved)) {
        // Put the blob back as it was. Left as it is, a field that holds a value other than the
        // legacy one would look like "both set and different" on the next load, and that run
        // would remove the legacy entry, which may be the only good copy. Never lose a key.
        if (rawPreferences === null) store.removeItem(PREFERENCES_KEY);
        else store.setItem(PREFERENCES_KEY, rawPreferences);
        return;
      }
    }

    for (const name of toRemove) store.removeItem(name);
    // Only after the removal succeeded
    for (const name of differing) {
      console.warn(`${name}: kept the key in the preferences and removed the older copy`);
    }
  } catch {
    // Storage is not available, or full: keep the old entries, and try again on the next load
    console.warn('Could not move the old API key entries into the preferences');
  }
}

function readBackMatches(
  store: StorageLike,
  moved: ReadonlyArray<{ field: string; value: string }>
): boolean {
  let readBack: unknown;
  try {
    readBack = JSON.parse(store.getItem(PREFERENCES_KEY) ?? 'null');
  } catch {
    return false;
  }
  return isPlainObject(readBack) && moved.every(({ field, value }) => readBack[field] === value);
}
