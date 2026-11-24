/**
 * Claude model IDs on every provider that serves them.
 *
 * Examples: `claude-haiku-5-5` and `claude-sonnet-4-5-20250929` (Anthropic),
 * `global.anthropic.claude-haiku-5-5` and `us.anthropic.claude-sonnet-4-5-20250929-v1:0` (Bedrock),
 * `anthropic/claude-sonnet-4.5` (OpenRouter), and the older form `claude-3-5-haiku-20241022`.
 *
 * Keep this file free of DOM and Node imports.
 */

export type ClaudeFamily = 'fable' | 'mythos' | 'opus' | 'sonnet' | 'haiku';

/** Where a Bedrock request runs. Regional endpoints cost more for Claude 4.5 and later. */
export type BedrockRouting = 'global' | 'regional';

export interface ClaudeModel {
  family: ClaudeFamily;
  major: number;
  minor: number;
  /** For example `haiku-5-5`, `sonnet-4`, `haiku-3-5` */
  key: string;
  /** From the Bedrock ID prefix: `global.` is global; a geography prefix or none is regional */
  routing?: BedrockRouting;
}

const FAMILY = '(fable|mythos|opus|sonnet|haiku)';
// claude-haiku-4-5-20251001: the minor version has one or two digits; a date is not a version
const NEW_FORM = new RegExp(`claude-${FAMILY}-(\\d{1,2})(?:[-.](\\d{1,2})(?!\\d))?`);
// claude-3-5-haiku-20241022, claude-3.5-haiku
const OLD_FORM = new RegExp(`claude-(\\d)(?:[-.](\\d))?-${FAMILY}`);
const BEDROCK_PREFIX = /^(?:([a-z-]+)\.)?anthropic\.claude-/;

export function parseClaudeModel(modelId: string): ClaudeModel | null {
  const id = modelId.toLowerCase();
  let family: ClaudeFamily;
  let major: number;
  let minor: number;

  const newForm = NEW_FORM.exec(id);
  const oldForm = newForm ? null : OLD_FORM.exec(id);
  if (newForm) {
    family = newForm[1] as ClaudeFamily;
    major = Number(newForm[2]);
    minor = Number(newForm[3] ?? 0);
  } else if (oldForm) {
    family = oldForm[3] as ClaudeFamily;
    major = Number(oldForm[1]);
    minor = Number(oldForm[2] ?? 0);
  } else {
    return null;
  }

  const bedrock = BEDROCK_PREFIX.exec(id);
  return {
    family,
    major,
    minor,
    key: minor ? `${family}-${major}-${minor}` : `${family}-${major}`,
    ...(bedrock && { routing: bedrock[1] === 'global' ? 'global' : 'regional' }),
  };
}

/** The model is this version or later */
export function isAtLeast(model: ClaudeModel, major: number, minor = 0): boolean {
  return model.major > major || (model.major === major && model.minor >= minor);
}

/**
 * Context window in tokens. Claude 4.6 and later models have 1M tokens; earlier models have 200K
 * (Sonnet 4 and 4.5 offered 1M only as a beta). Source: platform.claude.com, Models overview and
 * Context windows, read 2026-11-24.
 */
export function claudeContextWindow(model: ClaudeModel): number {
  return isAtLeast(model, 4, 6) ? 1_000_000 : 200_000;
}
