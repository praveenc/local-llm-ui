/**
 * Max tool steps: how many model calls one reply can use when tools (web search, MCP) are on.
 *
 * Shared by the browser and the server proxies. Each step is one model call. The last step must
 * give the answer (see server/tool-loop.ts), so a reply can use tools in at most
 * `maxToolSteps - 1` steps.
 */
export const MIN_TOOL_STEPS = 2;
export const MAX_TOOL_STEPS = 25;
export const DEFAULT_TOOL_STEPS = 10;

/** A whole number from MIN_TOOL_STEPS to MAX_TOOL_STEPS. Not a number: the default. */
export function clampToolSteps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOOL_STEPS;
  return Math.min(MAX_TOOL_STEPS, Math.max(MIN_TOOL_STEPS, Math.round(value)));
}

const STORAGE_KEY = 'local-llm-ui-max-tool-steps';

/**
 * Kept apart from the preferences, so that the Preferences dialog cannot overwrite it with an
 * older copy (as for the last selected model)
 */
export function loadMaxToolSteps(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_TOOL_STEPS : clampToolSteps(Number(stored));
  } catch {
    return DEFAULT_TOOL_STEPS;
  }
}

export function saveMaxToolSteps(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampToolSteps(value)));
  } catch (error) {
    console.error('Failed to save max tool steps:', error);
  }
}
