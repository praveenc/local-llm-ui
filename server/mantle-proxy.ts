/**
 * Bedrock Mantle Proxy
 *
 * Handles requests to Amazon Bedrock Mantle endpoints which provide
 * OpenAI-compatible APIs for model inference.
 */
import type { IncomingMessage, ServerResponse } from 'http';

import { mantleReasoningEffort } from '../src/utils/thinkingEffort.ts';
import {
  abortOnClose,
  capErrorText,
  capMaxTokens,
  endStreamWithError,
  isAbortAfterClientLeft,
  readChatRequest,
  setCORSHeaders,
  startEventStream,
} from './security.ts';
import { openAIUsage } from './usage.ts';

// Supported Mantle regions
const MANTLE_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'ap-northeast-1',
  'ap-south-1',
  'ap-southeast-3',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-north-1',
  'sa-east-1',
] as const;

type MantleRegion = (typeof MANTLE_REGIONS)[number];

function getMantleBaseUrl(region: MantleRegion): string {
  return `https://bedrock-mantle.${region}.api.aws/v1`;
}

function isValidRegion(region: string): region is MantleRegion {
  return MANTLE_REGIONS.includes(region as MantleRegion);
}

export async function handleMantleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Set CORS headers (SEC-05: restricted to dev server origins)
  setCORSHeaders(req, res, 'Content-Type, X-Mantle-Api-Key, X-Mantle-Region');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  // Extract API key and region from headers
  const apiKey = req.headers['x-mantle-api-key'] as string | undefined;
  const region = (req.headers['x-mantle-region'] as string) || 'us-west-2';

  if (!apiKey) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Bedrock Mantle API key is required',
        errorType: 'MissingApiKey',
        errorDetail:
          'Please configure your Bedrock Mantle API key in the preferences to use Mantle endpoints.',
      })
    );
    return;
  }

  if (!isValidRegion(region)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        // The header value is not echoed: it is the caller's text, of any length
        error: 'Invalid region',
        errorType: 'InvalidRegion',
        errorDetail: `Supported regions: ${MANTLE_REGIONS.join(', ')}`,
      })
    );
    return;
  }

  try {
    if (pathname === '/api/mantle/models') {
      await handleListModels(res, apiKey, region);
    } else if (pathname === '/api/mantle/chat') {
      await handleChat(req, res, apiKey, region);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    // The browser left and the upstream call stopped: nothing to report
    if (isAbortAfterClientLeft(error, res)) return;
    console.error('Mantle proxy error:', error);
    const err = error as Error;

    // The chat stream has started, so the status and headers are sent
    if (endStreamWithError(res, err.message || 'The model stream failed.')) return;

    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
      errorMessage = 'Invalid Bedrock Mantle API key. Please check your API key in preferences.';
      statusCode = 401;
    } else if (err.message?.includes('403') || err.message?.includes('Forbidden')) {
      errorMessage = 'Access denied. Your API key may not have access to this resource.';
      statusCode = 403;
    }

    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: errorMessage,
        errorType: err.name,
        errorDetail: capErrorText(err.message ?? ''),
      })
    );
  }
}

async function handleListModels(
  res: ServerResponse,
  apiKey: string,
  region: MantleRegion
): Promise<void> {
  const baseUrl = getMantleBaseUrl(region);

  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ id: string; owned_by?: string; created?: number }>;
  };

  // Transform OpenAI models format to our format with friendly names
  const models = (data.data || []).map(
    (model: { id: string; owned_by?: string; created?: number }) => ({
      modelId: model.id,
      modelName: formatModelName(model.id),
      provider: 'bedrock-mantle',
      modelFamily: getModelFamily(model.id),
      ownedBy: model.owned_by,
    })
  );

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models }));
}

/**
 * Format model ID into a friendly display name
 * e.g., "nvidia.nemotron-nano-9b-v2" -> "NVIDIA Nemotron Nano 9B v2"
 */
function formatModelName(modelId: string): string {
  // Split by dot to separate provider from model name
  const parts = modelId.split('.');
  const provider = parts[0];
  const modelPart = parts.slice(1).join('.');

  // Format provider name
  const providerName = formatProviderName(provider);

  // Format model name
  const modelName = modelPart
    .split('-')
    .map((word) => {
      // Handle size indicators (e.g., 9b, 30b, 120b)
      if (/^\d+b$/i.test(word)) {
        return word.toUpperCase();
      }
      // Handle version indicators (e.g., v2, v3)
      if (/^v\d+$/i.test(word)) {
        return word.toLowerCase();
      }
      // Handle year/date indicators (e.g., 2507)
      if (/^\d{4}$/.test(word)) {
        return word;
      }
      // Handle common abbreviations
      if (['a3b', 'a22b', 'oss'].includes(word.toLowerCase())) {
        return word.toUpperCase();
      }
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  return `${providerName} ${modelName}`.trim();
}

/**
 * Format provider prefix into display name
 */
function formatProviderName(provider: string): string {
  const providerNames: Record<string, string> = {
    nvidia: 'NVIDIA',
    openai: 'OpenAI',
    mistral: 'Mistral',
    qwen: 'Qwen',
    minimax: 'MiniMax',
    meta: 'Meta',
    anthropic: 'Anthropic',
    cohere: 'Cohere',
    ai21: 'AI21',
    amazon: 'Amazon',
  };
  return (
    providerNames[provider.toLowerCase()] || provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

/**
 * Extract model family from model ID
 */
function getModelFamily(modelId: string): string {
  const provider = modelId.split('.')[0].toLowerCase();
  const familyMap: Record<string, string> = {
    nvidia: 'NVIDIA',
    openai: 'OpenAI',
    mistral: 'Mistral AI',
    qwen: 'Alibaba Qwen',
    minimax: 'MiniMax',
    meta: 'Meta AI',
    anthropic: 'Anthropic',
    cohere: 'Cohere',
    ai21: 'AI21 Labs',
    amazon: 'Amazon',
  };
  return familyMap[provider] || 'Bedrock Mantle';
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string,
  region: MantleRegion
): Promise<void> {
  // Size limit, JSON, and the fields of every chat request (SEC-07, SEC-22)
  const request = await readChatRequest(req, res);
  if (!request) return; // 413 or 400 already sent
  const { model, messages, max_tokens, thinkingEffort } = request;

  const baseUrl = getMantleBaseUrl(region);
  // Sent only for models that take it (see utils/thinkingEffort)
  const reasoningEffort = mantleReasoningEffort(model, thinkingEffort);

  // Build request body for OpenAI-compatible API
  // No temperature or top_p: models use their own defaults
  const requestBody: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    stream: true;
    stream_options: { include_usage: boolean };
    max_tokens: number;
    reasoning_effort?: string;
  } = {
    model,
    messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: capMaxTokens(max_tokens),
    ...(reasoningEffort !== undefined && { reasoning_effort: reasoningEffort }),
  };

  // Stop the upstream call when the browser closes the connection
  const signal = abortOnClose(res);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }
  // Also stop reading a body whose source does not watch the signal
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });

  // Handle streaming response
  startEventStream(res);

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          // The end of the handler writes the one [DONE]
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Handle reasoning content (MiniMax, gpt-oss, and other thinking models)
            const reasoning = parsed.choices?.[0]?.delta?.reasoning;
            if (reasoning) {
              res.write(`data: ${JSON.stringify({ reasoning })}\n\n`);
            }

            // Handle regular content
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }

            // Usage is in the final chunk. Mantle has no tool loop: the reply is one model call.
            const usage = openAIUsage(parsed.usage);
            if (usage) {
              res.write(`data: ${JSON.stringify({ metadata: { usage } })}\n\n`);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
