/**
 * Model Context Utilities
 *
 * Maps model IDs to tokenlens format and provides context window limits.
 */
import { getContextWindow } from 'tokenlens';

import type { Provider } from '../utils/preferences';
import { getAnthropicContextWindow, isAnthropicModel } from './anthropicPricing';

// Default context limits for models not in tokenlens
const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
  // Bedrock Claude models
  'anthropic.claude-3-5-haiku-20241022-v1:0': 200000,
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 200000,
  'anthropic.claude-3-haiku-20240307-v1:0': 200000,
  'anthropic.claude-3-sonnet-20240229-v1:0': 200000,
  'anthropic.claude-3-opus-20240229-v1:0': 200000,
  // Anthropic direct API models (Claude 4.5 series)
  'claude-opus-4-5-20251101': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-sonnet-4-20250514': 200000,
  // Groq models
  'llama-3.3-70b-versatile': 131072,
  'llama-3.1-8b-instant': 131072,
  'llama-3.1-70b-versatile': 131072,
  'mixtral-8x7b-32768': 32768,
  'gemma2-9b-it': 8192,
  // Cerebras models (free tier limited)
  'llama-3.3-70b': 8192,
  'llama3.1-8b': 8192,
  // Ollama models (common defaults)
  'llama3.2:latest': 131072,
  'llama3.2:3b': 131072,
  'llama3.2:1b': 131072,
  'llama3.1:latest': 131072,
  'llama3.1:8b': 131072,
  'llama3.1:70b': 131072,
  'mistral:latest': 32768,
  'mistral:7b': 32768,
  'qwen2.5:latest': 131072,
  'qwen2.5:7b': 131072,
  'qwen2.5:14b': 131072,
  'qwen2.5:32b': 131072,
  'qwen2.5:72b': 131072,
  'qwen3:latest': 131072,
  'qwen3:4b': 131072,
  'qwen3:8b': 131072,
  'deepseek-r1:latest': 131072,
  'deepseek-r1:7b': 131072,
  'deepseek-r1:14b': 131072,
  'phi4:latest': 16384,
  'gemma2:latest': 8192,
  'gemma2:9b': 8192,
  // LM Studio models (common defaults)
  'lmstudio-community/llama-3.2-3b-instruct': 131072,
  'lmstudio-community/qwen2.5-7b-instruct': 131072,
  // Bedrock Mantle models (common defaults)
  'nvidia.nemotron-nano-9b-v2': 32768,
  'nvidia.nemotron-mini-4b-instruct': 32768,
  'mistral.mistral-large-2407': 128000,
  'mistral.mistral-small-2409': 32768,
  'qwen.qwen2.5-72b-instruct': 131072,
  'qwen.qwen2.5-32b-instruct': 131072,
  'meta.llama3-70b-instruct': 8192,
  'meta.llama3-8b-instruct': 8192,
  // Default fallback
  default: 128000,
};

/**
 * Maps our internal model ID to tokenlens model ID format
 */
function toTokenlensModelId(modelId: string, provider: Provider): string | null {
  // Anthropic direct API - return model ID for custom pricing calculation
  // We don't use tokenlens for Anthropic, we use our custom pricing
  if (provider === 'anthropic') {
    return modelId; // Return as-is, will be handled by anthropicPricing.ts
  }

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

  // Bedrock Mantle models - OpenAI-compatible endpoint with various providers
  if (provider === 'bedrock-mantle') {
    // NVIDIA models
    if (modelId.includes('nvidia')) {
      return null; // Not in tokenlens, use defaults
    }
    // Mistral models
    if (modelId.includes('mistral')) {
      if (modelId.includes('large')) {
        return 'mistral/mistral-large-latest';
      }
      if (modelId.includes('small')) {
        return 'mistral/mistral-small-latest';
      }
      return 'mistral/mistral-medium-latest';
    }
    // Qwen models
    if (modelId.includes('qwen')) {
      return null; // Not in tokenlens, use defaults
    }
    // Meta Llama models
    if (modelId.includes('meta') || modelId.includes('llama')) {
      return 'meta-llama/llama-3.3-70b-instruct';
    }
    // OpenAI models (if available via Mantle)
    if (modelId.includes('openai') || modelId.includes('gpt')) {
      if (modelId.includes('gpt-4o')) {
        return 'openai/gpt-4o';
      }
      if (modelId.includes('gpt-4')) {
        return 'openai/gpt-4-turbo';
      }
      return 'openai/gpt-3.5-turbo';
    }
    return null; // Unknown Mantle model, use defaults
  }

  // Groq models
  if (provider === 'groq') {
    return `groq/${modelId}`;
  }

  // Cerebras models
  if (provider === 'cerebras') {
    return `cerebras/${modelId}`;
  }

  // Ollama models - map to meta-llama or other providers where possible
  if (provider === 'ollama') {
    const modelLower = modelId.toLowerCase();
    if (modelLower.includes('llama')) {
      return 'meta-llama/llama-3.3-70b-instruct';
    }
    if (modelLower.includes('mistral')) {
      return 'mistral/mistral-7b-instruct-v0.3';
    }
    if (modelLower.includes('qwen')) {
      return null; // Not in tokenlens, use defaults
    }
    if (modelLower.includes('deepseek')) {
      return null; // Not in tokenlens, use defaults
    }
    if (modelLower.includes('phi')) {
      return null; // Not in tokenlens, use defaults
    }
    if (modelLower.includes('gemma')) {
      return 'google/gemma-2-9b-it';
    }
    return null; // Unknown Ollama model, use defaults
  }

  // LM Studio models - similar mapping
  if (provider === 'lmstudio') {
    const modelLower = modelId.toLowerCase();
    if (modelLower.includes('llama')) {
      return 'meta-llama/llama-3.3-70b-instruct';
    }
    if (modelLower.includes('mistral')) {
      return 'mistral/mistral-7b-instruct-v0.3';
    }
    if (modelLower.includes('qwen')) {
      return null; // Not in tokenlens, use defaults
    }
    if (modelLower.includes('deepseek')) {
      return null; // Not in tokenlens, use defaults
    }
    if (modelLower.includes('nemotron')) {
      return null; // Not in tokenlens, use defaults
    }
    return null; // Unknown LM Studio model, use defaults
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
  // Special handling for Anthropic direct API
  if (provider === 'anthropic' && isAnthropicModel(modelId)) {
    return {
      contextWindow: getAnthropicContextWindow(),
      outputMax: 8192,
      tokenlensModelId: modelId, // Pass through for custom pricing
    };
  }

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
