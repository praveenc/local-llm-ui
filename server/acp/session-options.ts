/**
 * The session options of an ACP session: the agent (category `mode`), the options that an app
 * control already sets (the model, the thought level, and ids that the harness names), and the
 * rest. A chat request may set the mode and the rest, to values that the session lists only:
 * an agent can take an unlisted value without an error and change the session (K9 probe), so the
 * check comes before the send, not after it.
 */
import { listsValue } from './config-options.ts';
import type { ConfigOption } from './types.ts';

/** ACP categories that an app control sets (the model picker, the Thinking menu) */
const APP_CATEGORIES: ReadonlySet<string> = new Set(['model', 'thought_level']);

export interface SplitSessionOptions {
  /** The option of category `mode`, when the session lists one */
  mode?: ConfigOption;
  /** The options that an app control sets */
  owned: ConfigOption[];
  /** The other select options, in the agent's order */
  rest: ConfigOption[];
}

const isOwned = (option: ConfigOption, ownedIds: readonly string[]) =>
  (option.category !== undefined && APP_CATEGORIES.has(option.category)) ||
  ownedIds.includes(option.id);

/** Splits a session's config options by ACP category */
export function splitSessionOptions(
  options: readonly ConfigOption[],
  ownedIds: readonly string[] = []
): SplitSessionOptions {
  const split: SplitSessionOptions = { owned: [], rest: [] };
  for (const option of options) {
    if (isOwned(option, ownedIds)) split.owned.push(option);
    // ACP has one mode option: a second one is left out
    else if (option.category === 'mode') split.mode ??= option;
    else if (option.type === 'select') split.rest.push(option);
  }
  return split;
}

export type OptionChangeCheck =
  | { ok: true; option: ConfigOption }
  /** unknown: the session lists no such select option; owned: an app control sets it */
  | { ok: false; reason: 'unknown' | 'owned'; option?: ConfigOption }
  /** The option does not list the value */
  | { ok: false; reason: 'value'; option: ConfigOption };

/** Whether a chat request may set this option to this value on a session with these options */
export function checkOptionChange(
  options: readonly ConfigOption[],
  ownedIds: readonly string[],
  id: string,
  value: string
): OptionChangeCheck {
  const option = options.find((o) => o.id === id);
  if (!option) return { ok: false, reason: 'unknown' };
  if (isOwned(option, ownedIds)) return { ok: false, reason: 'owned', option };
  // Only select options have a list of values to check against
  if (option.type !== 'select') return { ok: false, reason: 'unknown', option };
  if (!listsValue(option, value)) return { ok: false, reason: 'value', option };
  return { ok: true, option };
}
