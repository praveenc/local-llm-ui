/**
 * Short model labels for the chat input and the transcript.
 *
 * Bedrock names repeat the inference profile and the vendor: "Global Anthropic Claude Haiku 5.5".
 * The short label keeps the model and moves the profile to the end: "Claude Haiku 5.5 · Global".
 * The profile comes from the model ID (`global.`, `us.`, `eu.`, ...), so Global and US profiles
 * of one model stay apart. Other providers keep their names.
 *
 * Keep this file free of DOM and Node imports.
 */
import type { Provider } from '../db/types';

export interface ModelLabelInput {
  provider: Provider;
  id: string;
  name: string;
}

export interface ModelLabel {
  /** The model without the profile and vendor words, for example "Claude Haiku 5.5" */
  name: string;
  /** The Bedrock inference profile, for example "Global" or "US" */
  profile?: string;
  /** name and profile together, for example "Claude Haiku 5.5 · Global" */
  label: string;
}

const PROFILES: Record<string, string> = {
  global: 'Global',
  us: 'US',
  'us-gov': 'US GovCloud',
  eu: 'EU',
  apac: 'APAC',
  jp: 'JP',
  au: 'AU',
  ca: 'CA',
};

/** Vendor words that the model name repeats; the model family name follows them */
const VENDORS = ['Anthropic', 'OpenAI', 'Moonshot AI', 'xAI', 'Z.AI', 'Amazon', 'Meta'];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VENDOR_PREFIX = new RegExp(`^(?:${VENDORS.map(escape).join('|')})\\s+`, 'i');

export function modelLabel({ provider, id, name }: ModelLabelInput): ModelLabel {
  if (provider !== 'bedrock') return { name, label: name };

  const prefix = /^([a-z-]+)\./.exec(id)?.[1];
  const profile = prefix ? PROFILES[prefix] : undefined;
  let short = name.trim();
  if (profile) {
    // The name may start with the profile in any case: "GLOBAL Amazon Nova 2 Lite"
    short = short.replace(new RegExp(`^${escape(profile)}\\s+`, 'i'), '');
  }
  const withoutVendor = short.replace(VENDOR_PREFIX, '');
  // Keep the vendor when nothing is left after it
  if (withoutVendor.trim()) short = withoutVendor;

  return { name: short, profile, label: profile ? `${short} · ${profile}` : short };
}
