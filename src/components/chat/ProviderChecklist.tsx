/**
 * ProviderChecklist
 *
 * First-run empty state: every provider with its status and the one action that fixes it, so a
 * new user can get from "no model" to a working model without hunting through Preferences.
 */
import { Check, Loader2 } from 'lucide-react';

import type { ProviderModels } from '../../hooks/useAllModels';
import { loadPreferences } from '../../utils/preferences';
import { ProviderActionButton } from './ProviderActionButton';
import { getProviderHelp, getProvidersWithoutKey } from './providerHelp';

interface ProviderChecklistProps {
  providers: ProviderModels[];
  isLoading?: boolean;
  onOpenPreferences?: () => void;
}

export function ProviderChecklist({
  providers,
  isLoading,
  onOpenPreferences,
}: ProviderChecklistProps) {
  const withoutKey = getProvidersWithoutKey(loadPreferences());
  const hasModels = providers.some((p) => p.models.length > 0);

  return (
    <section aria-labelledby="provider-checklist-title" className="w-full max-w-xl px-4">
      <h2 id="provider-checklist-title" className="text-xl font-semibold text-foreground">
        {hasModels ? 'Pick a model to start' : 'Connect a model to start'}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasModels
          ? 'Choose one from Select model in the box below.'
          : 'Run a local model server or add a provider key. Each row says what is missing.'}
      </p>

      <ul className="mt-4 divide-y rounded-lg border bg-card" aria-busy={isLoading || undefined}>
        {providers.map((provider) => {
          const ready = provider.models.length > 0;
          const help = provider.status === 'error' ? getProviderHelp(provider) : null;
          return (
            <li key={provider.provider} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-foreground">{provider.providerName}</span>
                  <span className="text-muted-foreground">
                    {provider.status === 'loading' ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                        Checking…
                      </span>
                    ) : ready ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-3" />
                        {provider.models.length} model{provider.models.length === 1 ? '' : 's'}
                      </span>
                    ) : (
                      help?.status
                    )}
                  </span>
                </div>
                {help && <p className="mt-0.5 text-[13px] text-muted-foreground">{help.hint}</p>}
              </div>
              {help && (
                <ProviderActionButton action={help.action} onOpenPreferences={onOpenPreferences} />
              )}
            </li>
          );
        })}
        {withoutKey.length > 0 && (
          <li className="flex items-start gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">API key providers</div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                No key yet: {withoutKey.map((p) => p.label).join(', ')}.
              </p>
            </div>
            <ProviderActionButton
              action={{ kind: 'preferences', label: 'Add key' }}
              onOpenPreferences={onOpenPreferences}
            />
          </li>
        )}
      </ul>
    </section>
  );
}
