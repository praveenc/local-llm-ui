/** Helpers for the config options of a session (session/new, set_config_option) */
import type { ConfigOption } from './types.ts';

/** The option with this id */
export const optionById = (options: readonly ConfigOption[], id: string) =>
  options.find((o) => o.id === id);

/** True when the option lists this value */
export const listsValue = (option: ConfigOption | undefined, value: string) =>
  option?.options?.some((o) => o.value === value) === true;
