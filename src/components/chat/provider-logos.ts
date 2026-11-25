/**
 * Maps internal provider names to logo identifiers used by ModelSelectorLogo.
 * Logos are fetched from https://models.dev/logos/{provider}.svg. A value that starts with "/"
 * is a file of this app (the CSP allows only 'self' and models.dev).
 *
 * Used by ModelSelectorButton.
 */
export const PROVIDER_LOGO_MAP: Record<string, string> = {
  bedrock: 'amazon-bedrock',
  'bedrock-mantle': 'amazon-bedrock',
  groq: 'groq',
  cerebras: 'cerebras',
  lmstudio: 'lmstudio',
  ollama: 'llama',
  anthropic: 'anthropic',
  kiro: '/kiro-color.svg',
};
