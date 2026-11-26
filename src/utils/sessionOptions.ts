/**
 * Session options of an agent harness (K9): the agent (ACP category `mode`) and the other config
 * options that the agent lists and that no app control owns (for Kiro: Autopilot, Memory
 * reflection, …). The server sends them compact; the browser shows them and sends the user's
 * picks back as `sessionOptions` in the chat request. Shared by the browser and the server, so
 * no DOM or Node imports. The names, descriptions, and values are the agent's own (D15).
 */

/** The most entries that a chat request's `sessionOptions` may have; the rest are dropped */
export const MAX_SESSION_OPTION_ENTRIES = 20;
/** The longest option id or value that the app sends or shows */
export const MAX_SESSION_OPTION_CHARS = 200;
/** Names and descriptions are cut to these sizes for the browser */
export const MAX_SESSION_OPTION_NAME_CHARS = 120;
export const MAX_SESSION_OPTION_DESCRIPTION_CHARS = 300;
/** The most values of one option that the browser gets (the agent list can be long) */
export const MAX_SESSION_OPTION_VALUES = 200;

export interface SessionOptionValue {
  value: string;
  /** The agent's name of the value; the value itself when it has none */
  name: string;
  description?: string;
}

/** One select option as the browser gets it */
export interface SessionOption {
  id: string;
  /** The agent's name of the option; the id when it has none */
  name: string;
  description?: string;
  /** The ACP category, when the agent gives one (`mode` for the agent picker) */
  category?: string;
  currentValue: string;
  values: SessionOptionValue[];
}

/**
 * The session options of one session. Sent as:
 * - `sessionOptions` in the POST /api/kiro/models response (a new session: the agent's defaults),
 * - the SSE event `{ sessionOptions }` of POST /api/kiro/chat (after the `session` event, and on
 *   each config_option_update during the reply),
 * - `sessionOptions` in the POST /api/kiro/sessions/open response (the imported session's values).
 */
export interface SessionOptionsSnapshot {
  /** The option of ACP category `mode` (the agent), when the session lists one */
  mode?: SessionOption;
  /** The other options without an app control, in the agent's order */
  options: SessionOption[];
}

/** What a conversation stores: option id → current value (mode included). Values only. */
export type SessionOptionValues = Record<string, string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Keys that must never become own properties of a plain object built from a request */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Control characters have no place in an option id or value
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const isOptionString = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_SESSION_OPTION_CHARS &&
  !CONTROL.test(value);

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The `sessionOptions` of a chat request: at most MAX_SESSION_OPTION_ENTRIES entries whose id and
 * value are strings of 1 to MAX_SESSION_OPTION_CHARS characters. Anything else is dropped, never
 * an error. Undefined when nothing is left. The server still checks each entry against the
 * session's own list before it sends it to the agent.
 */
export function parseSessionOptionsRequest(value: unknown): SessionOptionValues | undefined {
  if (!isRecord(value)) return undefined;
  const entries: [string, string][] = [];
  for (const [id, v] of Object.entries(value)) {
    if (entries.length >= MAX_SESSION_OPTION_ENTRIES) break;
    if (UNSAFE_KEYS.has(id) || !isOptionString(id) || !isOptionString(v)) continue;
    entries.push([id, v]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * One option for the browser from an agent's config option (`{ id, name, description?,
 * category?, type, currentValue, options: [{ value, name, description? }] }`). Undefined for an
 * option that is not a select with string values. `_meta` and unknown fields are dropped; names
 * and descriptions are cut; values longer than MAX_SESSION_OPTION_CHARS are left out (the app
 * could not send them back).
 */
export function compactSessionOption(raw: unknown): SessionOption | undefined {
  if (!isRecord(raw) || raw.type !== 'select') return undefined;
  const { id, name, description, category, currentValue, options } = raw;
  if (!isOptionString(id) || !isOptionString(currentValue) || !Array.isArray(options)) {
    return undefined;
  }
  const values: SessionOptionValue[] = [];
  for (const entry of options) {
    if (values.length >= MAX_SESSION_OPTION_VALUES) break;
    if (!isRecord(entry) || !isOptionString(entry.value)) continue;
    const valueName =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name : entry.value;
    values.push({
      value: entry.value,
      name: cut(valueName, MAX_SESSION_OPTION_NAME_CHARS),
      ...(typeof entry.description === 'string' &&
        entry.description.trim() && {
          description: cut(entry.description, MAX_SESSION_OPTION_DESCRIPTION_CHARS),
        }),
    });
  }
  if (values.length === 0) return undefined;
  return {
    id,
    name: cut(typeof name === 'string' && name.trim() ? name : id, MAX_SESSION_OPTION_NAME_CHARS),
    ...(typeof description === 'string' &&
      description.trim() && {
        description: cut(description, MAX_SESSION_OPTION_DESCRIPTION_CHARS),
      }),
    ...(typeof category === 'string' && category && { category }),
    currentValue,
    values,
  };
}

/** The browser's check of a snapshot from the server; null when it is not one */
export function parseSessionOptionsSnapshot(value: unknown): SessionOptionsSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.options)) return null;
  const check = (raw: unknown): SessionOption | undefined => {
    if (!isRecord(raw) || !Array.isArray(raw.values)) return undefined;
    // The same shape as an agent option, so the same checks apply
    return compactSessionOption({ ...raw, type: 'select', options: raw.values });
  };
  const mode = value.mode === undefined ? undefined : check(value.mode);
  if (value.mode !== undefined && !mode) return null;
  const options: SessionOption[] = [];
  for (const raw of value.options) {
    const option = check(raw);
    if (!option) return null;
    options.push(option);
  }
  return { ...(mode && { mode }), options };
}

/** The current values of a snapshot, mode included: what a conversation stores */
export function snapshotValues(snapshot: SessionOptionsSnapshot): SessionOptionValues {
  const all = snapshot.mode ? [snapshot.mode, ...snapshot.options] : snapshot.options;
  return Object.fromEntries(all.map((o) => [o.id, o.currentValue]));
}

/** The snapshot with the stored values (and then the user's picks) as the current values */
export function withValues(
  snapshot: SessionOptionsSnapshot,
  ...layers: (SessionOptionValues | undefined)[]
): SessionOptionsSnapshot {
  const pick = (option: SessionOption): SessionOption => {
    let currentValue = option.currentValue;
    for (const layer of layers) {
      const v = layer?.[option.id];
      if (v !== undefined) currentValue = v;
    }
    return currentValue === option.currentValue ? option : { ...option, currentValue };
  };
  return {
    ...(snapshot.mode && { mode: pick(snapshot.mode) }),
    options: snapshot.options.map(pick),
  };
}

/** The agent's name of an option's current value; the value itself when the option lists none */
export function currentValueName(option: SessionOption): string {
  return option.values.find((v) => v.value === option.currentValue)?.name ?? option.currentValue;
}

/**
 * The `sessionOptions` for the next chat request.
 * - The request reuses the chat's session (`newSession` false): only the user's picks that differ
 *   from what the session reported. The agent keeps the session's values (also changes made in
 *   the terminal), so the app does not send them again.
 * - The request starts a new session (no session yet, or `kiroSessionIsStale`): the stored values
 *   with the picks on top, so a new session keeps the chat's choices.
 * Undefined when there is nothing to send.
 */
export function sessionOptionsToSend(input: {
  stored?: SessionOptionValues;
  pending?: SessionOptionValues;
  newSession: boolean;
}): SessionOptionValues | undefined {
  const { stored = {}, pending = {}, newSession } = input;
  const out: SessionOptionValues = newSession ? { ...stored, ...pending } : {};
  if (!newSession) {
    for (const [id, value] of Object.entries(pending)) {
      if (stored[id] !== value) out[id] = value;
    }
  }
  return parseSessionOptionsRequest(out);
}

/**
 * The default agent of a new chat (D9): the user's preferred agent id against the agent list of
 * a new session (the `mode` option of the models response).
 * - `values`: `{ [mode.id]: agentId }` when the list has the id. A new chat puts it under the
 *   user's picks, so a pick in the chat input still wins.
 * - `missing`: true when the list is known and does not have the id. The app then uses the
 *   agent's own default, and Preferences says so.
 * No id, or no list yet: no values, and `missing` is false.
 */
export function defaultModeValues(
  snapshot: SessionOptionsSnapshot | null | undefined,
  agentId: string | undefined
): { values?: SessionOptionValues; missing: boolean } {
  if (!agentId || !snapshot?.mode) return { missing: false };
  const { mode } = snapshot;
  if (!mode.values.some((v) => v.value === agentId)) return { missing: true };
  return { values: { [mode.id]: agentId }, missing: false };
}
