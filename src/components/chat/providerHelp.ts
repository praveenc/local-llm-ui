/**
 * What to tell the user about a provider that has no models, and the one action that fixes it.
 * Used by the first-run checklist and the model picker.
 */
import type { ProviderModels } from '../../hooks/useAllModels';
import { KIRO_SIGN_IN_MESSAGE } from '../../services/kiro';
import { isProviderConfigured } from '../../utils/preferences';
import type { Provider, UserPreferences } from '../../utils/preferences';
import { API_KEY_PROVIDERS } from '../sidebar/providerOptions';

export type ProviderAction =
  | { kind: 'copy'; label: string; value: string }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'preferences'; label: string };

export interface ProviderHelp {
  /** Short status, for example "Not running" */
  status: string;
  /** One sentence on how to fix it */
  hint: string;
  action: ProviderAction;
}

const OPEN_PREFERENCES: ProviderAction = { kind: 'preferences', label: 'Open Preferences' };

export const AWS_CREDENTIALS_DOCS =
  'https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html';
export const LMSTUDIO_SERVER_DOCS = 'https://lmstudio.ai/docs/app/api';

export function getProviderHelp(provider: ProviderModels): ProviderHelp {
  const error = provider.error || 'Currently unavailable';
  switch (provider.provider) {
    case 'ollama':
      return {
        status: 'Not running',
        hint: 'Start Ollama on localhost:11434, then reopen this list.',
        action: { kind: 'copy', label: 'Copy ollama serve', value: 'ollama serve' },
      };
    case 'lmstudio':
      return {
        status: 'Not running',
        hint: 'Start LM Studio and turn on its local server (localhost:1234) with JIT loading.',
        action: { kind: 'link', label: 'How to start', href: LMSTUDIO_SERVER_DOCS },
      };
    case 'bedrock':
      return {
        status: 'No access',
        hint: error,
        action: { kind: 'link', label: 'Set up AWS credentials', href: AWS_CREDENTIALS_DOCS },
      };
    case 'kiro':
      return provider.error === KIRO_SIGN_IN_MESSAGE
        ? {
            status: 'Not signed in',
            hint: 'Sign in to Kiro in Preferences → Providers, then reopen this list.',
            action: { kind: 'preferences', label: 'Sign in to Kiro' },
          }
        : {
            status: 'Not available',
            // The server's own words, for example that Kiro did not start
            hint: error,
            action: OPEN_PREFERENCES,
          };
    default:
      return { status: 'Error', hint: error, action: OPEN_PREFERENCES };
  }
}

/** API key providers with no key yet; they are not probed, so they are not in the model list */
export function getProvidersWithoutKey(
  preferences: UserPreferences
): { value: Provider; label: string }[] {
  return API_KEY_PROVIDERS.filter((p) => !isProviderConfigured(preferences, p.value)).map(
    ({ value, label }) => ({ value, label })
  );
}
