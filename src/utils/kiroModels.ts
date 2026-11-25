/**
 * Kiro models: what GET /api/kiro/models returns, short names, credit rates, and the Thinking
 * mapping. Shared by the browser and the server, so no DOM or Node imports.
 *
 * Kiro lists its models in the `model` config option of a session. Each name is the same as the
 * id (`claude-opus-5.5`), and `_meta.kiro` gives the credit rate and the effort levels.
 */
import type { ThinkingEffort } from './thinkingEffort.ts';

/** Kiro's effort levels, lowest first. `none` turns thinking off. */
export const KIRO_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type KiroEffortLevel = (typeof KIRO_EFFORT_LEVELS)[number];

export interface KiroModel {
  id: string;
  /** Short name for the model picker, for example "Claude Opus 5.5" */
  name: string;
  /** Kiro's description, for the tooltip */
  description?: string;
  /** Credits per request compared with the base rate, for example 2 or 0.06 */
  rateMultiplier?: number;
  /** The effort levels that the model takes, lowest first. Absent: no effort setting. */
  effortLevels?: KiroEffortLevel[];
  defaultEffortLevel?: KiroEffortLevel;
  /** The model has a separate thinking on/off switch */
  thinkingToggleable?: boolean;
}

/** What Kiro wants for the app's Thinking choice: either value can be absent */
export interface KiroEffortSetting {
  effortLevel?: KiroEffortLevel;
  thinking?: 'on' | 'off';
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

const isEffortLevel = (value: unknown): value is KiroEffortLevel =>
  KIRO_EFFORT_LEVELS.includes(value as KiroEffortLevel);

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Words that have their own spelling in a model name */
const WORDS: Record<string, string> = {
  agi: 'AGI',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  gpt: 'GPT',
  minimax: 'MiniMax',
  qwen3: 'Qwen3',
};

function wordLabel(word: string): string {
  const known = WORDS[word.toLowerCase()];
  if (known) return known;
  // A version or size: 5.5, 4.7, 1m, 120b
  if (/^\d/.test(word)) return word.toUpperCase();
  // A letter and a version: k3, m2.5
  if (/^[a-z]\d/i.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A short name from a Kiro model id:
 *   claude-opus-5.5 → Claude Opus 5.5, gpt-5.6-sol → GPT 5.6 Sol, kimi-k3 → Kimi K3,
 *   minimax-m2.5 → MiniMax M2.5, qwen3-coder-next → Qwen3 Coder Next, auto → Auto
 */
export function kiroModelLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(wordLabel)
    .join(' ');
}

/**
 * The models in the config options of a Kiro session (`session/new` or `session/load` result,
 * or a `config_option_update`), in Kiro's order. Returns [] when there is no model option.
 */
export function parseKiroModels(configOptions: unknown): KiroModel[] {
  if (!Array.isArray(configOptions)) return [];
  const option = configOptions.map(record).find((o) => o?.id === 'model');
  if (!option || !Array.isArray(option.options)) return [];

  const models: KiroModel[] = [];
  const seen = new Set<string>();
  for (const entry of option.options.map(record)) {
    const id = entry?.value;
    if (typeof id !== 'string' || !MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const meta = record(record(entry?._meta)?.kiro);
    const model: KiroModel = { id, name: kiroModelLabel(id) };
    if (typeof entry?.description === 'string' && entry.description.trim()) {
      model.description = entry.description.trim().slice(0, 300);
    }
    const rate = meta?.rateMultiplier;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) model.rateMultiplier = rate;
    if (meta?.hasEffort !== false && Array.isArray(meta?.effortLevels)) {
      const levels = KIRO_EFFORT_LEVELS.filter((level) =>
        (meta.effortLevels as unknown[]).includes(level)
      );
      if (levels.length > 0) model.effortLevels = levels;
      if (isEffortLevel(meta.defaultEffortLevel) && levels.includes(meta.defaultEffortLevel)) {
        model.defaultEffortLevel = meta.defaultEffortLevel;
      }
    }
    if (meta?.thinkingToggleable === true) model.thinkingToggleable = true;
    models.push(model);
  }
  return models;
}

/** The model has a Thinking choice: effort levels, or a thinking switch */
export function kiroSupportsThinking(
  model: Pick<KiroModel, 'effortLevels' | 'thinkingToggleable'>
) {
  return (model.effortLevels?.length ?? 0) > 0 || model.thinkingToggleable === true;
}

/** The app's levels in order. Minimal sits between none and low. */
const RANK: Record<Exclude<ThinkingEffort, 'default' | 'off'>, number> = {
  minimal: 0.5,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};
const KIRO_RANK: Record<KiroEffortLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

/** The level of the model that is nearest to the wanted rank; on a tie, the lower one */
function nearestLevel(levels: KiroEffortLevel[], rank: number): KiroEffortLevel | undefined {
  let best: KiroEffortLevel | undefined;
  for (const level of levels) {
    if (level === 'none') continue;
    if (
      best === undefined ||
      Math.abs(KIRO_RANK[level] - rank) < Math.abs(KIRO_RANK[best] - rank)
    ) {
      best = level;
    }
  }
  return best;
}

/**
 * What to set on a Kiro session for the app's Thinking choice (D8):
 * - Default: the model's own default level, and thinking on.
 * - Off: `none` when the model has it, else thinking off when the model has the switch, else
 *   the lowest level.
 * - Minimal to Max: that level, or the nearest level of the model (on a tie, the lower one).
 *   Minimal is the lowest level above `none`.
 *
 * Returns undefined when the model has no Thinking choice.
 */
export function kiroEffortSetting(
  effort: ThinkingEffort,
  model: Pick<KiroModel, 'effortLevels' | 'defaultEffortLevel' | 'thinkingToggleable'>
): KiroEffortSetting | undefined {
  if (!kiroSupportsThinking(model)) return undefined;
  const levels = model.effortLevels ?? [];
  const setting: KiroEffortSetting = {};

  if (effort === 'off') {
    if (levels.includes('none')) setting.effortLevel = 'none';
    else if (model.thinkingToggleable) setting.thinking = 'off';
    else setting.effortLevel = levels.find((level) => level !== 'none');
    return setting;
  }

  if (model.thinkingToggleable) setting.thinking = 'on';
  if (levels.length > 0) {
    setting.effortLevel =
      effort === 'default'
        ? model.defaultEffortLevel
        : effort === 'minimal'
          ? levels.find((level) => level !== 'none')
          : nearestLevel(levels, RANK[effort]);
  }
  if (setting.effortLevel === undefined) delete setting.effortLevel;
  return setting;
}

/**
 * The Thinking choices that the chat input shows for a Kiro model: Default, Off, then the
 * model's own levels (Low to Max). Minimal is not shown, because Kiro has no such level.
 * Returns [] when the model has no Thinking choice.
 */
export function kiroThinkingEfforts(
  model: Pick<KiroModel, 'effortLevels' | 'thinkingToggleable'>
): ThinkingEffort[] {
  if (!kiroSupportsThinking(model)) return [];
  const levels = (model.effortLevels ?? []).filter(
    (level): level is Exclude<KiroEffortLevel, 'none'> => level !== 'none'
  );
  return ['default', 'off', ...levels];
}

/** "2× credits", "1.3× credits", "0.06× credits" */
export function formatCreditRate(rate: number): string {
  return `${Number(rate.toFixed(2))}× credits`;
}

/** "0.05 credits", "1 credit", "1.24 credits". Small amounts keep two significant digits. */
export function formatCredits(credits: number): string {
  const value =
    credits === 0
      ? '0'
      : credits < 0.01
        ? credits.toPrecision(2)
        : String(Number(credits.toFixed(2)));
  return `${value} ${value === '1' ? 'credit' : 'credits'}`;
}
