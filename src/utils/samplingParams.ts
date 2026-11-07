/**
 * Which sampling parameters (temperature / top_p) a model accepts.
 *
 * Shared by the browser and the server proxies.
 *
 * Claude rules:
 * - Claude 3.x and older: both temperature and top_p
 * - Claude 4.0 - 4.6:     one of them, not both. Bedrock returns "`temperature` and
 *                         `top_p` cannot both be specified" (checked on Opus 4.6, Haiku 4.5)
 * - Claude 4.7+ and 5.x (Opus, Sonnet, Haiku, Fable, Mythos): neither. Bedrock returns
 *   "`temperature` is deprecated for this model". Omit them; top_k is also not supported.
 * Non-Claude models: both.
 *
 * Sources:
 * - https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-7.html
 *   "Starting with Claude Opus 4.7, `temperature`, `top_p`, and `top_k` parameters are no
 *   longer supported. The recommended migration path is to omit these parameters entirely"
 * - https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-request-response.html
 * - https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
 * The Converse InferenceConfiguration type still lists temperature/topP as optional,
 * so the SDK does not stop us from sending them. Leave the keys out (not null).
 */

export type SamplingSupport = 'both' | 'one' | 'none';

export interface SamplingInput {
  temperature?: number;
  topP?: number;
  /** For models that accept only one parameter: which one to send */
  preferred?: 'temperature' | 'topP';
}

export interface SamplingOutput {
  temperature?: number;
  topP?: number;
}

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

export function getSamplingSupport(modelId: string): SamplingSupport {
  if (!/claude/i.test(modelId)) return 'both';
  const version = getClaudeVersion(modelId);
  if (!version || version.major < 4) return 'both';
  if (version.major === 4 && version.minor <= 6) return 'one';
  return 'none';
}

/**
 * Return only the sampling parameters that the model accepts.
 */
export function buildSamplingParams(modelId: string, input: SamplingInput): SamplingOutput {
  const { temperature, topP, preferred } = input;
  switch (getSamplingSupport(modelId)) {
    case 'none':
      return {};
    case 'one':
      if (preferred === 'topP' && topP !== undefined) return { topP };
      if (temperature !== undefined) return { temperature };
      if (topP !== undefined) return { topP };
      return {};
    default:
      return {
        ...(temperature !== undefined && { temperature }),
        ...(topP !== undefined && { topP }),
      };
  }
}
