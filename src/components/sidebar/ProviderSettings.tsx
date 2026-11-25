/**
 * ProviderSettings
 *
 * Default provider choice and API keys in one list. A provider that needs an API key
 * can become the default only after its key is set.
 */
import { Check } from 'lucide-react';

import { Fragment, type ReactNode, useState } from 'react';

import { SecretInput } from '@/components/shared/SecretInput';
import { Button } from '@/components/ui/button';
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

import type { KiroSignIn } from '../../hooks/useKiroSignIn';
import { kiroAccountLabel } from '../../utils/kiroStatus';
import type { KiroStatus } from '../../utils/kiroStatus';
import { PROVIDER_API_KEY_FIELDS, isProviderConfigured } from '../../utils/preferences';
import type { KiroSignInPreference } from '../../utils/preferences';
import type { ApiKeyField, Provider, UserPreferences } from '../../utils/preferences';
import {
  THINKING_EFFORT_PROVIDERS,
  defaultThinkingEffortOptions,
  getDefaultThinkingEffort,
  isThinkingEffort,
} from '../../utils/thinkingEffort';
import type { ThinkingEffort } from '../../utils/thinkingEffort';
import { KIRO_PANEL_ID, KiroSignInPanel } from './KiroSignInPanel';
import type { KiroPanelMode } from './KiroSignInPanel';
import {
  API_KEY_PROVIDERS,
  KIRO_PROVIDER,
  MANTLE_REGIONS,
  NO_KEY_PROVIDERS,
} from './providerOptions';
import type { ProviderOption } from './providerOptions';

interface ProviderSettingsProps {
  preferences: UserPreferences;
  onUpdate: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  /** State of kiro-cli. The Kiro row shows only when it is known and kiro-cli is installed. */
  kiro?: {
    status: KiroStatus | undefined;
    refresh: () => void | Promise<void>;
    isRefreshing: boolean;
    signIn: KiroSignIn;
    /** Say whether Kiro becomes the default provider when the sign-in ends */
    setMakeDefault: (value: boolean) => void;
  };
}

export function ProviderSettings({ preferences, onUpdate, kiro }: ProviderSettingsProps) {
  const [editing, setEditing] = useState<Provider | null>(null);
  const [kiroPanel, setKiroPanel] = useState<KiroPanelMode>('closed');

  const handleProviderChange = (value: string) => {
    // Kiro cannot be the default until you sign in: open the sign-in and keep the choice
    if (value === 'kiro' && kiro?.status?.state === 'signed-out') {
      kiro.setMakeDefault(true);
      if (kiro.signIn.phase === 'idle') setKiroPanel('form');
      return;
    }
    // The last pick wins: a sign-in that ends later does not make Kiro the default
    kiro?.setMakeDefault(false);
    onUpdate('preferredProvider', value as Provider);
  };

  // Default thinking effort, shown on the selected provider's row
  const thinkingRow = (option: ProviderOption) =>
    option.value === preferences.preferredProvider && (
      <DefaultThinkingRow
        option={option}
        value={getDefaultThinkingEffort(preferences.thinkingEffortByProvider, option.value)}
        onChange={(effort) =>
          onUpdate('thinkingEffortByProvider', {
            ...preferences.thinkingEffortByProvider,
            [option.value]: effort,
          })
        }
      />
    );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Default provider</h3>
        <p className="text-xs text-muted-foreground">
          New conversations start with the model you last picked in the chat. If that model is not
          available, they use the last model from this provider. Add an API key to make a provider
          available.
        </p>
      </div>

      <RadioGroup
        aria-label="Default provider"
        value={preferences.preferredProvider}
        onValueChange={handleProviderChange}
        className="gap-4"
      >
        <ProviderGroup title="AWS and local">
          {NO_KEY_PROVIDERS.map((option) => (
            <Fragment key={option.value}>
              <ProviderRow
                option={option}
                status={<span className="text-xs text-muted-foreground">{option.detail}</span>}
              >
                {thinkingRow(option)}
              </ProviderRow>
              {/* Alphabetical: Kiro comes after Amazon Bedrock */}
              {option.value === 'bedrock' && kiro && (
                <KiroRow
                  {...kiro}
                  panel={kiroPanel}
                  onPanelChange={setKiroPanel}
                  saved={preferences.kiroSignIn}
                  isDefault={preferences.preferredProvider === 'kiro'}
                  onRemember={(pref) => onUpdate('kiroSignIn', pref)}
                  thinking={thinkingRow(KIRO_PROVIDER)}
                />
              )}
            </Fragment>
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
                    <span className="flex items-center gap-1 text-xs text-status-ok">
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
                      <SecretInput
                        id={`provider-${option.value}-key`}
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
                {thinkingRow(option)}
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
      <p className="text-[13px] text-muted-foreground">{title}</p>
      <div className="divide-y rounded-lg border">{children}</div>
    </div>
  );
}

type KiroRowProps = NonNullable<ProviderSettingsProps['kiro']> & {
  panel: KiroPanelMode;
  onPanelChange: (mode: KiroPanelMode) => void;
  saved?: KiroSignInPreference;
  isDefault: boolean;
  onRemember: (preference: KiroSignInPreference) => void;
  /** The Default thinking row, when Kiro is the default provider */
  thinking?: ReactNode;
};

/** The Kiro row: shows whether kiro-cli is installed, up to date, and signed in */
function KiroRow({
  status,
  refresh,
  isRefreshing,
  signIn,
  setMakeDefault,
  panel,
  onPanelChange,
  saved,
  isDefault,
  onRemember,
  thinking,
}: KiroRowProps) {
  if (!status || status.state === 'not-installed') return null;
  const signedIn = status.state === 'signed-in';
  const signedOut = status.state === 'signed-out';

  let action: ReactNode = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7"
      disabled={isRefreshing}
      aria-label="Check again (Kiro)"
      onClick={() => void refresh()}
    >
      {isRefreshing ? 'Checking…' : 'Check again'}
    </Button>
  );
  if (signedIn) {
    action = (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7"
        aria-expanded={panel === 'sign-out'}
        aria-controls={KIRO_PANEL_ID}
        aria-label="Sign out (Kiro)"
        onClick={() => onPanelChange(panel === 'sign-out' ? 'closed' : 'sign-out')}
      >
        Sign out
      </Button>
    );
  } else if (signedOut) {
    action = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7"
        disabled={signIn.phase !== 'idle'}
        aria-expanded={panel === 'form' || signIn.phase !== 'idle'}
        aria-controls={KIRO_PANEL_ID}
        aria-label="Sign in (Kiro)"
        onClick={() => onPanelChange('form')}
      >
        Sign in
      </Button>
    );
  }

  return (
    <ProviderRow
      option={KIRO_PROVIDER}
      // Signed out: you can pick Kiro, and the app asks you to sign in
      disabled={!signedIn && !signedOut}
      status={
        <span
          aria-live="polite"
          className={cn(
            'flex items-center gap-1 text-xs',
            signedIn ? 'text-status-ok' : 'text-muted-foreground'
          )}
        >
          {signedIn && <Check className="h-3 w-3" aria-hidden />}
          {KIRO_STATUS_TEXT[status.state]}
        </span>
      }
      action={action}
    >
      <div className="break-words border-t bg-muted/40 py-2 pl-10 pr-3 text-xs text-muted-foreground">
        <KiroDetail status={status} refresh={refresh} isRefreshing={isRefreshing} />
      </div>
      <KiroSignInPanel
        signedIn={signedIn}
        signIn={signIn}
        mode={panel}
        onModeChange={onPanelChange}
        saved={saved}
        isDefault={isDefault}
        onRemember={onRemember}
        onDismiss={() => setMakeDefault(false)}
      />
      {thinking}
    </ProviderRow>
  );
}

const KIRO_STATUS_TEXT: Record<Exclude<KiroStatus['state'], 'not-installed'>, string> = {
  'signed-in': 'Signed in',
  'signed-out': 'Not signed in',
  unsupported: 'Update needed',
  error: 'Cannot run',
};

function KiroDetail({
  status,
  refresh,
  isRefreshing,
}: {
  status: KiroStatus;
  refresh: KiroRowProps['refresh'];
  isRefreshing: boolean;
}) {
  switch (status.state) {
    case 'signed-in':
      return (
        <>
          {[
            status.account.email,
            kiroAccountLabel(status.account.type),
            `Kiro CLI ${status.version}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </>
      );
    case 'signed-out':
      return (
        <>
          Sign in with AWS Builder ID or IAM Identity Center. You can also run{' '}
          <code className="font-mono">kiro-cli login</code> in a terminal, then click{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={isRefreshing}
            aria-label="Check again (Kiro)"
            onClick={() => void refresh()}
          >
            {isRefreshing ? 'Checking…' : 'Check again'}
          </Button>
          .
        </>
      );
    case 'unsupported':
      return (
        <>
          Kiro CLI {status.version} is not supported. Update to Kiro CLI 3 with{' '}
          <code className="font-mono">kiro-cli update</code>.
        </>
      );
    case 'error':
      return (
        <>
          Could not run <code className="font-mono">{status.path}</code>: {status.message}
        </>
      );
    default:
      return null;
  }
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

interface DefaultThinkingRowProps {
  option: ProviderOption;
  value: ThinkingEffort;
  onChange: (value: ThinkingEffort) => void;
}

/**
 * Default thinking effort for one provider. The chat input starts with this value when you pick
 * one of the provider's models. Not shown for providers that do not send a thinking effort.
 */
function DefaultThinkingRow({ option, value, onChange }: DefaultThinkingRowProps) {
  if (!THINKING_EFFORT_PROVIDERS.includes(option.value)) return null;
  const id = `provider-${option.value}-thinking`;
  return (
    <div className="flex items-center gap-3 border-t bg-muted/40 py-2 pl-10 pr-3">
      <Label htmlFor={id} className="flex-1 text-xs font-normal">
        Default thinking
        <span className="block text-muted-foreground">
          Used by models that accept a thinking effort.
        </span>
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isThinkingEffort(next)) onChange(next);
        }}
      >
        <SelectTrigger
          id={id}
          size="sm"
          className="w-32"
          aria-label={`Default thinking (${option.label})`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {defaultThinkingEffortOptions(option.value).map((effort) => (
            <SelectItem key={effort.value} value={effort.value}>
              {effort.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
