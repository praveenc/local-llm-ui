/**
 * Thinking effort: how much a model reasons before it answers.
 *
 * Shared by the browser and the server proxies.
 *
 * The proxies pass the effort to the AI SDK `reasoning` call option. The SDK maps it to each
 * model's own setting:
 * - Claude 4.6+ and 5.x: adaptive thinking with `effort`. "Off" on models that cannot turn
 *   thinking off (for example Opus 5.5) uses the lowest setting instead.
 * - Claude 4.0 - 4.5: a thinking token budget (a share of the model's max output tokens).
 * - OpenAI reasoning models (GPT-5+, o-series, gpt-oss): `reasoning_effort`. A level the model
 *   does not have maps to the nearest one (for example XHigh -> High on gpt-oss).
 * - Amazon Nova 2 (Bedrock): `reasoningConfig` with low, medium, or high.
 *
 * Ollama and Bedrock Mantle do not use the AI SDK option. See `ollamaThinkValue` and
 * `mantleReasoningEffort`.
 *
 * "Default" sends nothing, so the model uses its own default.
 */
import type { Provider } from '../db/types.ts';

export type ThinkingEffort = 'default' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** The AI SDK `reasoning` call option values that we send */
export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const THINKING_EFFORT_OPTIONS: ReadonlyArray<{ value: ThinkingEffort; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

/** Providers whose proxy sends the thinking effort */
export const THINKING_EFFORT_PROVIDERS: readonly Provider[] = [
  'bedrock',
  'bedrock-mantle',
  'anthropic',
  'openrouter',
  'groq',
  'ollama',
];

export const isThinkingEffort = (value: unknown): value is ThinkingEffort =>
  THINKING_EFFORT_OPTIONS.some((option) => option.value === value);

export const thinkingEffortLabel = (effort: ThinkingEffort): string =>
  THINKING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ?? effort;

/**
 * Get the Claude major/minor version from a model ID in the new naming style
 * (claude-<family>-<major>[-<minor>]), for example:
 *   global.anthropic.claude-haiku-5-5            -> 5.5
 *   anthropic.claude-haiku-4-5-20251001-v1:0     -> 4.5
 *   anthropic.claude-sonnet-4-20250514-v1:0      -> 4.0 (date is not a minor version)
 *   claude-opus-4-6                              -> 4.6
 * Old style IDs (claude-3-5-sonnet, claude-v2) return null.
 */
export function getClaudeVersion(modelId: string): { major: number; minor: number } | null {
  const match = /claude-[a-z]+-(\d+)(?:[-.](\d{1,2})(?!\d))?/i.exec(modelId);
  if (!match) return null;
  return { major: Number(match[1]), minor: match[2] ? Number(match[2]) : 0 };
}

/** Claude 4.0 and later (new naming style, for example claude-sonnet-4-5, claude-opus-5) */
const isClaudeThinkingModel = (modelId: string): boolean => {
  if (!/claude/i.test(modelId)) return false;
  const version = getClaudeVersion(modelId);
  return version !== null && version.major >= 4;
};

/**
 * OpenAI reasoning models: GPT-5 and later, gpt-oss, and the o-series, for example
 * us.openai.gpt-5.4, openai/gpt-oss-120b, openai/o3-mini. Not gpt-4o or gpt-4.1.
 */
const isOpenAIReasoningModel = (modelId: string): boolean =>
  /(?:^|[./])(?:gpt-(?:[5-9]|\d{2,})|gpt-oss|o[1-9](?:-|$))/i.test(modelId);

/** Amazon Nova 2 models on Bedrock, for example us.amazon.nova-2-lite-v1:0 */
const isNova2Model = (modelId: string): boolean => /amazon\.nova-2-/i.test(modelId);

/** xAI Grok models on Bedrock, for example global.xai.grok-4.7, us.xai.grok-4.6 */
export const isGrokModel = (modelId: string): boolean => /xai\.grok-/i.test(modelId);

/**
 * How a Bedrock Mantle model takes `reasoning_effort` (checked on Mantle, us-west-2):
 * - 'levels': low, medium, and high change how much it thinks. It cannot turn thinking off
 *   (gpt-oss rejects 'none'; Kimi K2 Thinking thinks anyway).
 * - 'toggle': only 'high' turns thinking on. 'none', 'low', and 'medium' all give no thinking.
 * Other Mantle models ignore the setting (Mistral, Gemma, Qwen3 Coder, MiniMax M2), or fail
 * with it (Qwen3 235B 2507 returns an empty reply at 'high'), so the app does not send it.
 */
const MANTLE_THINKING_MODELS: ReadonlyArray<{ pattern: RegExp; style: 'levels' | 'toggle' }> = [
  { pattern: /^openai\.gpt-oss-/i, style: 'levels' },
  { pattern: /^moonshotai\.kimi-k2-thinking/i, style: 'levels' },
  { pattern: /^moonshotai\.kimi-k2\.5/i, style: 'toggle' },
  { pattern: /^deepseek\.v3\./i, style: 'toggle' },
  { pattern: /^zai\.glm-/i, style: 'toggle' },
  { pattern: /^qwen\.qwen3-(?:32b|next-)/i, style: 'toggle' },
  { pattern: /^nvidia\.nemotron-(?:super|nano)-3-/i, style: 'toggle' },
];

const mantleThinkingStyle = (modelId: string) =>
  MANTLE_THINKING_MODELS.find((entry) => entry.pattern.test(modelId))?.style;

/**
 * True when the app can send a thinking effort for this model.
 *
 * `reported` is the provider's own answer, for providers that report it per model (Ollama
 * lists "thinking" in a model's capabilities). Without it, Ollama models get no effort.
 */
export function supportsThinkingEffort(
  provider: Provider,
  modelId: string,
  reported?: boolean
): boolean {
  switch (provider) {
    case 'bedrock':
      return (
        isClaudeThinkingModel(modelId) ||
        isOpenAIReasoningModel(modelId) ||
        isNova2Model(modelId) ||
        isGrokModel(modelId)
      );
    case 'bedrock-mantle':
      return mantleThinkingStyle(modelId) !== undefined;
    case 'ollama':
      return reported === true;
    case 'openrouter':
      return isClaudeThinkingModel(modelId) || isOpenAIReasoningModel(modelId);
    case 'anthropic':
      return isClaudeThinkingModel(modelId);
    case 'groq':
      return isOpenAIReasoningModel(modelId);
    default:
      return false;
  }
}

/**
 * The AI SDK `reasoning` option to send, or an empty object to send nothing.
 * Takes `unknown` because the server gets the effort from the request body.
 */
export function buildReasoningParams(
  provider: Provider,
  modelId: string,
  effort: unknown
): { reasoning?: ReasoningLevel } {
  if (!isThinkingEffort(effort) || effort === 'default') return {};
  if (!supportsThinkingEffort(provider, modelId)) return {};
  return { reasoning: effort === 'off' ? 'none' : effort };
}

/**
 * The efforts that the chat offers for a model. Most models get the full list. Grok on Bedrock
 * always reasons and takes only low, medium, high, and xhigh, so Off and Minimal are left out.
 */
export function thinkingEffortOptions(
  provider: Provider,
  modelId: string
): ReadonlyArray<{ value: ThinkingEffort; label: string }> {
  if (provider === 'bedrock' && isGrokModel(modelId)) {
    return THINKING_EFFORT_OPTIONS.filter((o) => o.value !== 'off' && o.value !== 'minimal');
  }
  return THINKING_EFFORT_OPTIONS;
}

/**
 * The `reasoning_effort` to send to Grok on Bedrock in `additionalModelRequestFields`. The AI SDK
 * Bedrock provider does not map its `reasoning` option for Grok, so the proxy sets the field
 * itself. Grok cannot turn reasoning off and has no minimal level: both use low.
 */
export function grokReasoningEffort(level: ReasoningLevel): 'low' | 'medium' | 'high' | 'xhigh' {
  return level === 'none' || level === 'minimal' ? 'low' : level;
}

/**
 * The default effort for a provider, from Preferences
 */
export const getDefaultThinkingEffort = (
  defaults: Partial<Record<Provider, ThinkingEffort>> | undefined,
  provider: Provider | undefined
): ThinkingEffort => {
  const effort = provider ? defaults?.[provider] : undefined;
  return isThinkingEffort(effort) ? effort : 'default';
};

/**
 * The `reasoning_effort` value to send to Bedrock Mantle, or undefined to send none.
 *
 * Mantle accepts only 'none', 'low', 'medium', and 'high'. Minimal maps to Low and XHigh to
 * High. For 'toggle' models, any level above Off maps to High, because lower values give no
 * thinking. Off sends 'none', except on 'levels' models, which reject it or ignore it; there
 * Off uses Low, their lowest level.
 */
export function mantleReasoningEffort(
  modelId: string,
  effort: unknown
): 'none' | 'low' | 'medium' | 'high' | undefined {
  if (!isThinkingEffort(effort) || effort === 'default') return undefined;
  const style = mantleThinkingStyle(modelId);
  if (!style) return undefined;
  if (style === 'toggle') return effort === 'off' ? 'none' : 'high';
  switch (effort) {
    case 'off':
    case 'minimal':
      return 'low';
    case 'xhigh':
      return 'high';
    default:
      return effort;
  }
}

/** A model's thinking controls, as Ollama reports them in /api/show */
export interface OllamaThinkingInfo {
  /** Accepted `think` values: booleans for on/off, strings for named levels */
  values?: Array<boolean | string>;
}

/**
 * The Ollama `think` value to send, or undefined to send none.
 *
 * Ollama takes `think` as true/false, or as a named level for models that list levels in
 * /api/show (gpt-oss: low, medium, high). Checked on Ollama 0.40:
 * - gpt-oss ignores `false` and always thinks, so Off uses its lowest level, 'low'.
 * - Ollama rejects names it does not know ("minimal", "xhigh"), so Minimal maps to Low and
 *   XHigh to High.
 * - On on/off models such as Qwen3, every level above Off sends `true`. A level name on these
 *   models does not set the amount of thinking.
 */
export function ollamaThinkValue(
  effort: unknown,
  thinking: OllamaThinkingInfo | undefined
): boolean | 'low' | 'medium' | 'high' | undefined {
  if (!isThinkingEffort(effort) || effort === 'default') return undefined;
  const levels = (thinking?.values ?? []).filter(
    (value): value is 'low' | 'medium' | 'high' =>
      value === 'low' || value === 'medium' || value === 'high'
  );
  if (levels.length === 0) return effort !== 'off';

  const wanted =
    effort === 'off' || effort === 'minimal' ? 'low' : effort === 'xhigh' ? 'high' : effort;
  if (levels.includes(wanted)) return wanted;
  // Nearest listed level: lower first, then higher
  const order = ['low', 'medium', 'high'] as const;
  const index = order.indexOf(wanted);
  return (
    [...order.slice(0, index).reverse(), ...order.slice(index + 1)].find((level) =>
      levels.includes(level)
    ) ?? levels[0]
  );
}

const REASONING_LEVELS: readonly ReasoningLevel[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

/**
 * The level to retry with when a model rejects the requested effort.
 *
 * Models do not all accept every level, for example OpenAI models on Bedrock reject
 * "minimal", and some reject "none". Bedrock lists the values that the model accepts:
 *   Unsupported value: 'minimal' is not supported with the 'us.openai.gpt-5.4' model.
 *   Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.
 * Use the next lower accepted level, else the next higher one. Never fall back to 'none', so
 * "Off" on a model that must reason uses its lowest level. This is the rule that the AI SDK uses.
 *
 * Returns null when the message has no list of accepted values, or the list has the requested
 * level (the request failed for another reason).
 */
export function fallbackReasoningLevel(
  requested: ReasoningLevel,
  errorMessage: string
): ReasoningLevel | null {
  const list = /Supported values are:([^.]*)/i.exec(errorMessage)?.[1];
  if (!list) return null;
  const supported = [...list.matchAll(/'([a-z]+)'/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((value): value is ReasoningLevel => REASONING_LEVELS.includes(value as ReasoningLevel));
  if (supported.includes(requested)) return null;

  const index = REASONING_LEVELS.indexOf(requested);
  const candidates = [
    ...REASONING_LEVELS.slice(1, index).reverse(),
    ...REASONING_LEVELS.slice(index + 1),
  ];
  return candidates.find((level) => supported.includes(level)) ?? null;
}
