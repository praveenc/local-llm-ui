/**
 * Maps internal provider names to logo identifiers used by ModelSelectorLogo.
 * Logos are fetched from https://models.dev/logos/{provider}.svg
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
};
