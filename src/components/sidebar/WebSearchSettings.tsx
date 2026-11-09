/**
 * WebSearchSettings
 *
 * API keys for the web search providers, the provider tried first, and the fallback switch.
 * A provider can become the primary provider only after its key is set.
 */
import { Check } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { UserPreferences } from '../../utils/preferences';
import {
  WEB_SEARCH_KEY_FIELDS,
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_LABELS,
  getPrimaryWebSearchProvider,
  hasWebSearchKey,
  isWebSearchFallbackEnabled,
  isWebSearchProvider,
} from '../../utils/webSearch';
import type { WebSearchProvider } from '../../utils/webSearch';

interface WebSearchProviderInfo {
  keyUrl: string;
  /** Free plan, as published by the provider (checked November 2026) */
  freeTier: string;
}

const PROVIDER_INFO: Record<WebSearchProvider, WebSearchProviderInfo> = {
  brave: {
    keyUrl: 'https://api-dashboard.search.brave.com/app/keys',
    freeTier: '$5 free credit each month, about 1,000 searches. Needs a credit card.',
  },
  exa: {
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    freeTier: '$10 free credit each month, about 1,400 searches. No credit card.',
  },
  tavily: {
    keyUrl: 'https://app.tavily.com',
    freeTier: '1,000 free searches each month. No credit card.',
  },
};

interface WebSearchSettingsProps {
  preferences: UserPreferences;
  onUpdate: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
}

export function WebSearchSettings({ preferences, onUpdate }: WebSearchSettingsProps) {
  const [editing, setEditing] = useState<WebSearchProvider | null>(null);
  const primary = getPrimaryWebSearchProvider(preferences);
  const keyCount = WEB_SEARCH_PROVIDERS.filter((p) => hasWebSearchKey(preferences, p)).length;

  const updateKey = (provider: WebSearchProvider, value: string) => {
    onUpdate(WEB_SEARCH_KEY_FIELDS[provider], value);
    // Save the primary provider, so that a new key does not change it. The first key sets it.
    if (!preferences.webSearchProvider && value) {
      onUpdate('webSearchProvider', primary ?? provider);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Web search</h3>
        <p className="text-xs text-muted-foreground">
          With a key set, the globe button in the chat input lets the model search the web. The
          primary provider is tried first. Add a key to make a provider available.
        </p>
      </div>

      <div role="group" aria-label="Web search providers" className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Primary provider
        </p>
        <RadioGroup
          aria-label="Primary web search provider"
          value={primary ?? ''}
          onValueChange={(v) => {
            if (isWebSearchProvider(v)) onUpdate('webSearchProvider', v);
          }}
          className="gap-0 divide-y rounded-lg border"
        >
          {WEB_SEARCH_PROVIDERS.map((provider) => {
            const label = WEB_SEARCH_PROVIDER_LABELS[provider];
            const field = WEB_SEARCH_KEY_FIELDS[provider];
            const { keyUrl, freeTier } = PROVIDER_INFO[provider];
            const hasKey = hasWebSearchKey(preferences, provider);
            const isEditing = editing === provider;
            const id = `web-search-${provider}`;
            const panelId = `${id}-key-panel`;

            return (
              <div key={provider}>
                <div className="flex min-h-11 items-center gap-3 px-3 py-2">
                  <RadioGroupItem value={provider} id={id} disabled={!hasKey} />
                  <Label
                    htmlFor={id}
                    className={cn(
                      'flex flex-1 flex-col items-start gap-0.5 font-normal',
                      hasKey ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground'
                    )}
                  >
                    {label}
                    <span className="text-xs text-muted-foreground">{freeTier}</span>
                  </Label>
                  {hasKey ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-500">
                      <Check className="h-3 w-3" aria-hidden />
                      Key set
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No key</span>
                  )}
                  <Button
                    type="button"
                    variant={hasKey || isEditing ? 'ghost' : 'outline'}
                    size="sm"
                    className="h-7 w-16"
                    aria-expanded={isEditing}
                    aria-controls={panelId}
                    aria-label={`${isEditing ? 'Done' : hasKey ? 'Edit key' : 'Add key'} (${label})`}
                    onClick={() => setEditing(isEditing ? null : provider)}
                  >
                    {isEditing ? 'Done' : hasKey ? 'Edit' : 'Add key'}
                  </Button>
                </div>

                {isEditing && (
                  <div id={panelId} className="space-y-1.5 border-t bg-muted/40 py-3 pl-10 pr-3">
                    <Label htmlFor={`${id}-key`}>{label} API key</Label>
                    <Input
                      id={`${id}-key`}
                      type="password"
                      autoComplete="off"
                      autoFocus
                      value={preferences[field] || ''}
                      onChange={(e) => updateKey(provider, e.target.value.trim())}
                      placeholder="Paste your API key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Get a key at{' '}
                      <a
                        href={keyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {new URL(keyUrl).host}
                      </a>
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </RadioGroup>
      </div>

      <div className="flex items-start gap-3 rounded-lg border px-3 py-3">
        <Label
          htmlFor="web-search-fallback"
          className="flex flex-1 flex-col items-start gap-1 leading-snug"
        >
          Use the next provider when one fails
          <span className="text-xs font-normal text-muted-foreground">
            {keyCount < 2
              ? 'Add keys for two or more providers to use this.'
              : 'If the primary provider has no quota left, is rate limited, or does not respond, try the next provider that has a key.'}
          </span>
        </Label>
        <Switch
          id="web-search-fallback"
          checked={isWebSearchFallbackEnabled(preferences)}
          onCheckedChange={(checked) => onUpdate('webSearchFallback', checked)}
          disabled={keyCount < 2}
        />
      </div>
    </div>
  );
}
