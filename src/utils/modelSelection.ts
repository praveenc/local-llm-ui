/**
 * Choose which model the chat input selects
 */
import type { ProviderModels, UnifiedModel } from '../hooks/useAllModels';
import type { Provider } from './preferences';

export interface ModelRef {
  id: string;
  provider: Provider;
}

/**
 * The loaded model that matches a reference, or null when that model is not available
 */
export const findModel = (providers: ProviderModels[], ref?: ModelRef): UnifiedModel | null => {
  if (!ref) return null;
  return (
    providers
      .flatMap((p) => p.models)
      .find((m) => m.id === ref.id && m.provider === ref.provider) ?? null
  );
};

/**
 * Model for a new chat: the model last picked in the chat input, when it is still available.
 * Else the last one used with the preferred provider, else that provider's first model. When the
 * preferred provider has no models (no API key, or not running), the last model used with any
 * provider.
 */
export const pickDefaultModel = (
  providers: ProviderModels[],
  preferredProvider: Provider,
  recent: { last?: ModelRef; preferred?: ModelRef; any?: ModelRef }
): UnifiedModel | null => {
  const lastPicked = findModel(providers, recent.last);
  if (lastPicked) return lastPicked;
  const preferredModels = providers.find((p) => p.provider === preferredProvider)?.models ?? [];
  if (preferredModels.length > 0) {
    return findModel(providers, recent.preferred) ?? preferredModels[0];
  }
  return findModel(providers, recent.any);
};
