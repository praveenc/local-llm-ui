/**
 * Provider metadata for the Preferences dialog
 */
import type { Provider } from '../../utils/preferences';

export interface ProviderOption {
  value: Provider;
  label: string;
  icon: string;
  /** Connection detail, for providers that need no API key */
  detail?: string;
  /** Where to get an API key, for providers that need one */
  keyUrl?: string;
  /** Black icon that must be inverted in dark mode */
  mono?: boolean;
}

export const NO_KEY_PROVIDERS: ProviderOption[] = [
  {
    value: 'bedrock',
    label: 'Amazon Bedrock',
    icon: '/bedrock_bw.svg',
    mono: true,
    detail: 'AWS credentials',
  },
  {
    value: 'lmstudio',
    label: 'LM Studio',
    icon: '/lmstudio_icon.svg',
    mono: true,
    detail: 'localhost:1234',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    icon: '/ollama_icon.svg',
    mono: true,
    detail: 'localhost:11434',
  },
];

export const API_KEY_PROVIDERS: ProviderOption[] = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    icon: '/claude-color.svg',
    keyUrl: 'https://console.anthropic.com',
  },
  { value: 'bedrock-mantle', label: 'Bedrock Mantle', icon: '/bedrock-color.svg' },
  {
    value: 'cerebras',
    label: 'Cerebras',
    icon: '/cerebras_icon.svg',
    keyUrl: 'https://cloud.cerebras.ai',
  },
  {
    value: 'groq',
    label: 'Groq',
    icon: '/groq_icon.svg',
    mono: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    icon: '/openrouter_icon.svg',
    mono: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
];

export const MANTLE_REGIONS = [
  { label: 'US East (N. Virginia)', value: 'us-east-1' },
  { label: 'US East (Ohio)', value: 'us-east-2' },
  { label: 'US West (Oregon)', value: 'us-west-2' },
  { label: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
  { label: 'Asia Pacific (Mumbai)', value: 'ap-south-1' },
  { label: 'Europe (Frankfurt)', value: 'eu-central-1' },
  { label: 'Europe (Ireland)', value: 'eu-west-1' },
];

export const providerLabel = (provider: Provider): string =>
  [...NO_KEY_PROVIDERS, ...API_KEY_PROVIDERS].find((p) => p.value === provider)?.label ?? provider;
