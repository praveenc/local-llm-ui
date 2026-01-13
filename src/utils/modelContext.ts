/**
 * Model Context Utilities
 *
 * Maps model IDs to tokenlens format and provides context window limits.
 */
import { getContextWindow } from 'tokenlens';

import type { Provider } from '../utils/preferences';

// Default context limits for models not in tokenlens
const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
  // Bedrock Claude models
  'anthropic.claude-3-5-haiku-20241022-v1:0': 200000,
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 200000,
  'anthropic.claude-3-haiku-20240307-v1:0': 200000,
  'anthropic.claude-3-sonnet-20240229-v1:0': 200000,
  'anthropic.claude-3-opus-20240229-v1:0': 200000,
  // Groq models
  'llama-3.3-70b-versatile': 131072,
  'llama-3.1-8b-instant': 131072,
  'llama-3.1-70b-versatile': 131072,
  'mixtral-8x7b-32768': 32768,
  'gemma2-9b-it': 8192,
  // Cerebras models (free tier limited)
  'llama-3.3-70b': 8192,
  'llama3.1-8b': 8192,
  // Default fallback
  default: 128000,
};

/**
 * Maps our internal model ID to tokenlens model ID format
 */
function toTokenlensModelId(modelId: string, provider: Provider): string | null {
  // Bedrock models - map to Anthropic format
  if (provider === 'bedrock') {
    if (modelId.includes('claude-3-5-haiku')) {
      return 'anthropic/claude-3-5-haiku-20241022';
    }
    if (modelId.includes('claude-3-5-sonnet')) {
      return 'anthropic/claude-3-5-sonnet-20241022';
    }
    if (modelId.includes('claude-3-haiku')) {
      return 'anthropic/claude-3-haiku-20240307';
    }
    if (modelId.includes('claude-3-sonnet')) {
      return 'anthropic/claude-3-sonnet-20240229';
    }
    if (modelId.includes('claude-3-opus')) {
      return 'anthropic/claude-3-opus-20240229';
    }
    // Llama models on Bedrock
    if (modelId.includes('llama')) {
      return 'meta-llama/llama-3.3-70b-instruct';
    }
  }

  // Groq models
  if (provider === 'groq') {
    return `groq/${modelId}`;
  }

  // Cerebras models
  if (provider === 'cerebras') {
    return `cerebras/${modelId}`;
  }

  return null;
}

export interface ContextLimits {
  contextWindow: number;
  outputMax: number;
  tokenlensModelId: string | null;
}

/**
 * Gets context window limits for a model
 */
export function getModelContextLimits(modelId: string, provider: Provider): ContextLimits {
  const tokenlensId = toTokenlensModelId(modelId, provider);

  if (tokenlensId) {
    try {
      const context = getContextWindow(tokenlensId);
      if (context) {
        return {
          contextWindow: context.totalMax || context.combinedMax || DEFAULT_CONTEXT_LIMITS.default,
          outputMax: context.outputMax || 8192,
          tokenlensModelId: tokenlensId,
        };
      }
    } catch {
      // Model not found in tokenlens, use defaults
    }
  }

  // Fallback to hardcoded defaults
  const defaultLimit = DEFAULT_CONTEXT_LIMITS[modelId] || DEFAULT_CONTEXT_LIMITS.default;
  return {
    contextWindow: defaultLimit,
    outputMax: 8192,
    tokenlensModelId: tokenlensId,
  };
}
