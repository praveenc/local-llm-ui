/**
 * User preferences management utilities
 */
import type { Provider } from '../db/types';
import type { MCPServersMap } from '../types/mcp';
import type { ColorTheme } from './colorThemes';
import type { ThinkingEffort } from './thinkingEffort';
import type { WebSearchPreferences } from './webSearch';

export type { Provider };
export type VisualMode = 'light' | 'dark';
export type ContentDensity = 'comfortable' | 'compact';

export interface UserPreferences extends WebSearchPreferences {
  preferredProvider: Provider;
  visualMode: VisualMode;
  /** Color palette; visualMode picks its light or dark variant */
  colorTheme: ColorTheme;
  /** Spacing of the chat and the sidebar. Set as data-density on <html>. */
  contentDensity: ContentDensity;
  /** 1-2 letters shown next to your messages. Empty: no avatar. */
  avatarInitials: string;
  // Bedrock Mantle settings
  bedrockMantleApiKey?: string;
  bedrockMantleRegion?: string;
  // AI SDK provider settings
  groqApiKey?: string;
  cerebrasApiKey?: string;
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  // Web search keys and provider order: see WebSearchPreferences
  // MCP Servers
  mcpServers?: MCPServersMap;
  // Default thinking effort for each provider
  thinkingEffortByProvider?: Partial<Record<Provider, ThinkingEffort>>;
}

const STORAGE_KEY = 'local-llm-ui-preferences';

const DEFAULT_PREFERENCES: UserPreferences = {
  preferredProvider: 'ollama',
  visualMode: 'light',
  colorTheme: 'cosmic-night',
  contentDensity: 'comfortable',
  avatarInitials: '',
  bedrockMantleRegion: 'us-west-2',
};

/**
 * Load user preferences from localStorage
 */
export const loadPreferences = (): UserPreferences => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_PREFERENCES,
        ...parsed,
      };
    }
  } catch (error) {
    console.error('Failed to load preferences:', error);
  }
  return DEFAULT_PREFERENCES;
};

/**
 * Save user preferences to localStorage
 */
export const PREFERENCES_CHANGED_EVENT = 'preferences-changed';

export const savePreferences = (preferences: UserPreferences): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    // Notify same-tab listeners (window.storage only fires cross-tab)
    window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT));
  } catch (error) {
    console.error('Failed to save preferences:', error);
  }
};

export type ApiKeyField =
  'bedrockMantleApiKey' | 'groqApiKey' | 'cerebrasApiKey' | 'anthropicApiKey' | 'openrouterApiKey';

/**
 * Preference field that holds the API key, for providers that need one
 */
export const PROVIDER_API_KEY_FIELDS: Partial<Record<Provider, ApiKeyField>> = {
  'bedrock-mantle': 'bedrockMantleApiKey',
  groq: 'groqApiKey',
  cerebras: 'cerebrasApiKey',
  anthropic: 'anthropicApiKey',
  openrouter: 'openrouterApiKey',
};

/**
 * True when a provider needs no API key, or its API key is set
 */
export const isProviderConfigured = (preferences: UserPreferences, provider: Provider): boolean => {
  const field = PROVIDER_API_KEY_FIELDS[provider];
  return !field || !!preferences[field]?.trim();
};

/**
 * Clean avatar initials: letters and digits only, at most 2, upper case. Empty means no avatar.
 */
export const validateInitials = (value: string): string =>
  value
    .replace(/[^A-Z0-9]/gi, '')
    .slice(0, 2)
    .toUpperCase();

/**
 * The model last picked in the chat input. Kept apart from the preferences so that the
 * Preferences dialog cannot overwrite it with an older copy.
 */
export interface LastSelectedModel {
  id: string;
  provider: Provider;
}

const LAST_MODEL_KEY = 'local-llm-ui-last-model';

export const loadLastSelectedModel = (): LastSelectedModel | undefined => {
  try {
    const stored = localStorage.getItem(LAST_MODEL_KEY);
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as Partial<LastSelectedModel>;
    if (typeof parsed.id === 'string' && typeof parsed.provider === 'string') {
      return { id: parsed.id, provider: parsed.provider };
    }
  } catch (error) {
    console.error('Failed to load last selected model:', error);
  }
  return undefined;
};

export const saveLastSelectedModel = (model: LastSelectedModel): void => {
  try {
    localStorage.setItem(
      LAST_MODEL_KEY,
      JSON.stringify({ id: model.id, provider: model.provider } satisfies LastSelectedModel)
    );
  } catch (error) {
    console.error('Failed to save last selected model:', error);
  }
};

export const clearLastSelectedModel = (): void => {
  try {
    localStorage.removeItem(LAST_MODEL_KEY);
  } catch (error) {
    console.error('Failed to clear last selected model:', error);
  }
};
