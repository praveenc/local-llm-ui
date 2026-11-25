/**
 * Order of the provider groups in the model picker
 */
import type { Provider } from '../db/types';

/**
 * The provider whose group shows first: the provider of the selected model, or, with no model
 * selected, the default provider from Preferences.
 */
export const currentProvider = (
  selected: { provider: Provider } | null | undefined,
  defaultProvider: Provider | undefined
): Provider | undefined => selected?.provider ?? defaultProvider;

/**
 * Put the group of the current provider first. The other groups keep their order. Returns the
 * same items in a new array, and does not change the input.
 */
export const currentProviderFirst = <T extends { provider: Provider }>(
  groups: readonly T[],
  current: Provider | undefined
): T[] => {
  if (current === undefined) return [...groups];
  return [
    ...groups.filter((group) => group.provider === current),
    ...groups.filter((group) => group.provider !== current),
  ];
};
