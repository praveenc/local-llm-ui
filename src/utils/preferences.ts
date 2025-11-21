/**
 * User preferences management utilities
 */

export type Provider = 'ollama' | 'lmstudio' | 'bedrock';

export interface UserPreferences {
  preferredProvider: Provider;
  avatarInitials: string;
}

const STORAGE_KEY = 'local-llm-ui-preferences';

const DEFAULT_PREFERENCES: UserPreferences = {
  preferredProvider: 'ollama',
  avatarInitials: 'PC',
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
export const savePreferences = (preferences: UserPreferences): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.error('Failed to save preferences:', error);
  }
};

/**
 * Validate avatar initials (2 alphanumeric characters max, auto-uppercase)
 */
export const validateInitials = (value: string): string => {
  // Remove non-alphanumeric characters
  const cleaned = value.replace(/[^A-Z0-9]/gi, '');
  // Limit to 2 characters and uppercase
  return cleaned.slice(0, 2).toUpperCase();
};
