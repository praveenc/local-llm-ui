/**
 * Anthropic Pricing Utilities
 *
 * Calculates token costs for Anthropic Claude models.
 * Prices are in USD per million tokens (MTok).
 *
 * Source: https://docs.anthropic.com/en/docs/about-claude/pricing
 */

interface AnthropicModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

// Pricing per million tokens (MTok) in USD
const ANTHROPIC_PRICING: Record<string, AnthropicModelPricing> = {
  // Claude 4.5 Series (Current Generation)
  'claude-opus-4-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },

  // Claude 4 Series (Legacy but supported)
  'claude-opus-4-1': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-opus-4': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4': { inputPerMTok: 3, outputPerMTok: 15 },

  // Claude 3.x Series (Legacy)
  'claude-sonnet-3-7': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-3-5': { inputPerMTok: 0.8, outputPerMTok: 4 },
  'claude-opus-3': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-haiku-3': { inputPerMTok: 0.25, outputPerMTok: 1.25 },
};

/**
 * Extracts the base model name from a full model ID
 * e.g., "claude-haiku-4-5-20251001" -> "claude-haiku-4-5"
 */
function getBaseModelName(modelId: string): string | null {
  // Try to match known model patterns
  for (const baseModel of Object.keys(ANTHROPIC_PRICING)) {
    if (modelId.includes(baseModel)) {
      return baseModel;
    }
  }
  return null;
}

export interface AnthropicCostResult {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Calculates the cost for Anthropic API usage
 *
 * @param modelId - The Anthropic model ID (e.g., "claude-haiku-4-5-20251001")
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Cost breakdown in USD, or null if model not recognized
 */
export function calculateAnthropicCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): AnthropicCostResult | null {
  const baseModel = getBaseModelName(modelId);

  if (!baseModel) {
    return null;
  }

  const pricing = ANTHROPIC_PRICING[baseModel];
  if (!pricing) {
    return null;
  }

  // Convert tokens to millions and calculate cost
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
  const totalCost = inputCost + outputCost;

  return {
    inputCost,
    outputCost,
    totalCost,
  };
}

/**
 * Checks if a model ID is an Anthropic model
 */
export function isAnthropicModel(modelId: string): boolean {
  return modelId.startsWith('claude-');
}

/**
 * Gets the context window size for an Anthropic model
 */
export function getAnthropicContextWindow(): number {
  // All Claude 4.5 and 4 models have 200K context
  // Sonnet 4 and 4.5 can have 1M in beta, but default is 200K
  return 200_000;
}
