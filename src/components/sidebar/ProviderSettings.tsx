/**
 * ProviderSettings
 *
 * Default provider choice and API keys in one list. A provider that needs an API key
 * can become the default only after its key is set.
 */
import { Check } from 'lucide-react';

import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { PROVIDER_API_KEY_FIELDS, isProviderConfigured } from '../../utils/preferences';
import type { ApiKeyField, Provider, UserPreferences } from '../../utils/preferences';
import { API_KEY_PROVIDERS, MANTLE_REGIONS, NO_KEY_PROVIDERS } from './providerOptions';
import type { ProviderOption } from './providerOptions';

interface ProviderSettingsProps {
  preferences: UserPreferences;
  onUpdate: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
}

export function ProviderSettings({ preferences, onUpdate }: ProviderSettingsProps) {
  const [editing, setEditing] = useState<Provider | null>(null);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Default provider</h3>
        <p className="text-xs text-muted-foreground">
          New conversations start with the last model you used from this provider. Add an API key to
          make a provider available.
        </p>
      </div>

      <RadioGroup
        aria-label="Default provider"
        value={preferences.preferredProvider}
        onValueChange={(v) => onUpdate('preferredProvider', v as Provider)}
        className="gap-4"
      >
        <ProviderGroup title="AWS and local">
          {NO_KEY_PROVIDERS.map((option) => (
            <ProviderRow
              key={option.value}
              option={option}
              status={<span className="text-xs text-muted-foreground">{option.detail}</span>}
            />
          ))}
        </ProviderGroup>

        <ProviderGroup title="API key providers">
          {API_KEY_PROVIDERS.map((option) => {
            const field = PROVIDER_API_KEY_FIELDS[option.value] as ApiKeyField;
            const hasKey = isProviderConfigured(preferences, option.value);
            const isEditing = editing === option.value;
            const panelId = `provider-${option.value}-key-panel`;

            return (
              <ProviderRow
                key={option.value}
                option={option}
                disabled={!hasKey}
                status={
                  hasKey ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-500">
                      <Check className="h-3 w-3" aria-hidden />
                      Key set
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No key</span>
                  )
                }
                action={
                  <Button
                    type="button"
                    variant={hasKey || isEditing ? 'ghost' : 'outline'}
                    size="sm"
                    className="h-7 w-16"
                    aria-expanded={isEditing}
                    aria-controls={panelId}
                    aria-label={`${isEditing ? 'Done' : hasKey ? 'Edit key' : 'Add key'} (${option.label})`}
                    onClick={() => setEditing(isEditing ? null : option.value)}
                  >
                    {isEditing ? 'Done' : hasKey ? 'Edit' : 'Add key'}
                  </Button>
                }
              >
                {isEditing && (
                  <div id={panelId} className="space-y-3 border-t bg-muted/40 py-3 pl-10 pr-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`provider-${option.value}-key`}>{option.label} API key</Label>
                      <Input
                        id={`provider-${option.value}-key`}
                        type="password"
                        autoComplete="off"
                        autoFocus
                        value={preferences[field] || ''}
                        onChange={(e) => onUpdate(field, e.target.value.trim())}
                        placeholder="Paste your API key"
                      />
                      {option.keyUrl && (
                        <p className="text-xs text-muted-foreground">
                          Get a key at{' '}
                          <a
                            href={option.keyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {new URL(option.keyUrl).host}
                          </a>
                        </p>
                      )}
                    </div>

                    {option.value === 'bedrock-mantle' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="provider-mantle-region">Region</Label>
                        <Select
                          value={preferences.bedrockMantleRegion || 'us-west-2'}
                          onValueChange={(v) => onUpdate('bedrockMantleRegion', v)}
                        >
                          <SelectTrigger id="provider-mantle-region">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MANTLE_REGIONS.map((region) => (
                              <SelectItem key={region.value} value={region.value}>
                                {region.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </ProviderRow>
            );
          })}
        </ProviderGroup>
      </RadioGroup>
    </div>
  );
}

function ProviderGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="divide-y rounded-lg border">{children}</div>
    </div>
  );
}

interface ProviderRowProps {
  option: ProviderOption;
  disabled?: boolean;
  status: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}

function ProviderRow({ option, disabled, status, action, children }: ProviderRowProps) {
  const id = `provider-${option.value}`;
  return (
    <div>
      <div className="flex min-h-11 items-center gap-3 px-3 py-2">
        <RadioGroupItem value={option.value} id={id} disabled={disabled} />
        <Label
          htmlFor={id}
          className={cn(
            'flex flex-1 items-center gap-2 font-normal',
            disabled ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'
          )}
        >
          <img
            src={option.icon}
            alt=""
            className={cn('h-4 w-4', option.mono && 'dark:invert', disabled && 'opacity-50')}
          />
          {option.label}
        </Label>
        {status}
        {action}
      </div>
      {children}
    </div>
  );
}
