/**
 * Choose which model the chat input selects
 */
import type { ProviderModels, UnifiedModel } from '../hooks/useAllModels';
import type { Provider } from './preferences';

export interface ModelRef {
  id: string;
  provider: Provider;
}

/** Model to select once the model list has loaded */
export type PendingModel =
  | { kind: 'conversation'; conversationId: string; model: ModelRef }
  | {
      kind: 'default';
      provider: Provider;
      last?: ModelRef;
      preferred?: ModelRef;
      any?: ModelRef;
    };

/**
 * The app waits for Kiro's model list only when the model to restore, or the selected model,
 * can be a Kiro model. Kiro takes seconds to start, so other users must not wait for it.
 */
export const needsKiroModels = (
  providers: ProviderModels[],
  pending: PendingModel | null,
  selected?: { provider: Provider } | null
): boolean => {
  if (selected?.provider === 'kiro') return true;
  if (!pending) return false;
  if (pending.kind === 'conversation') return pending.model.provider === 'kiro';
  if (pending.provider === 'kiro' || pending.last?.provider === 'kiro') return true;
  // The last model of any provider counts only when the preferred provider has no models
  const preferredModels = providers.find((p) => p.provider === pending.provider)?.models ?? [];
  return preferredModels.length === 0 && pending.any?.provider === 'kiro';
};

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

/** Providers that run on this machine and cost nothing per request */
export const LOCAL_PROVIDERS: readonly Provider[] = ['ollama', 'lmstudio'];

/**
 * First model of a local provider (Ollama, then LM Studio), for a first run with no saved or
 * recent model. Never a paid provider: picking one silently would make the next send cost money.
 */
export const pickLocalModel = (providers: ProviderModels[]): UnifiedModel | null => {
  for (const provider of LOCAL_PROVIDERS) {
    const first = providers.find((p) => p.provider === provider)?.models[0];
    if (first) return first;
  }
  return null;
};
