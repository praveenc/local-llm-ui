/**
 * Bedrock Mantle Proxy
 *
 * Handles requests to Amazon Bedrock Mantle endpoints which provide
 * OpenAI-compatible APIs for model inference.
 */
import type { IncomingMessage, ServerResponse } from 'http';

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

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Mantle-Api-Key, X-Mantle-Region');

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
        error: `Invalid region: ${region}`,
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
    } else if (pathname === '/api/mantle/regions') {
      handleListRegions(res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('Mantle proxy error:', error);
    const err = error as Error;

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
        errorDetail: err.message,
      })
    );
  }
}

function handleListRegions(res: ServerResponse): void {
  const regions = MANTLE_REGIONS.map((region) => ({
    id: region,
    name: getRegionDisplayName(region),
    endpoint: getMantleBaseUrl(region),
  }));

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ regions }));
}

function getRegionDisplayName(region: MantleRegion): string {
  const names: Record<MantleRegion, string> = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-2': 'US West (Oregon)',
    'ap-northeast-1': 'Asia Pacific (Tokyo)',
    'ap-south-1': 'Asia Pacific (Mumbai)',
    'ap-southeast-3': 'Asia Pacific (Jakarta)',
    'eu-central-1': 'Europe (Frankfurt)',
    'eu-west-1': 'Europe (Ireland)',
    'eu-west-2': 'Europe (London)',
    'eu-south-1': 'Europe (Milan)',
    'eu-north-1': 'Europe (Stockholm)',
    'sa-east-1': 'South America (São Paulo)',
  };
  return names[region] || region;
}

async function handleListModels(
  res: ServerResponse,
  apiKey: string,
  region: MantleRegion
): Promise<void> {
  const baseUrl = getMantleBaseUrl(region);

  console.log(`Mantle: Fetching models from ${baseUrl}/models`);

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

  console.log(`Mantle: Found ${models.length} models in ${region}`);

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
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { model, messages, temperature, max_tokens, top_p, stream = true } = JSON.parse(body);

  const baseUrl = getMantleBaseUrl(region);

  console.log(`Mantle: Chat request for model: ${model} in region: ${region}`);
  console.log(`Mantle: Messages count: ${messages?.length || 0}`);
  console.log(
    `Mantle: Inference config: temperature=${temperature}, max_tokens=${max_tokens}, top_p=${top_p}`
  );

  // Build request body for OpenAI-compatible API
  const requestBody: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    stream: boolean;
    stream_options?: { include_usage: boolean };
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
  } = {
    model,
    messages: messages.map((msg: { role: string; content: string }) => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    })),
    stream,
    // Request usage data in streaming mode
    ...(stream && { stream_options: { include_usage: true } }),
  };

  // Add optional parameters if provided
  if (temperature !== undefined) {
    requestBody.temperature = temperature;
  }
  if (max_tokens !== undefined) {
    requestBody.max_tokens = max_tokens;
  }
  if (top_p !== undefined) {
    requestBody.top_p = top_p;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
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

  if (stream) {
    // Handle streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

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
            if (data === '[DONE]') {
              res.write('data: [DONE]\n\n');
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              // Handle reasoning content (e.g., MiniMax models)
              const reasoning = parsed.choices?.[0]?.delta?.reasoning;
              if (reasoning) {
                res.write(`data: ${JSON.stringify({ reasoning })}\n\n`);
              }

              // Handle regular content
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }

              // Check for usage info in the final chunk
              if (parsed.usage) {
                console.log('Mantle: Received usage data:', parsed.usage);
                res.write(
                  `data: ${JSON.stringify({
                    metadata: {
                      usage: {
                        inputTokens: parsed.usage.prompt_tokens,
                        outputTokens: parsed.usage.completion_tokens,
                        totalTokens: parsed.usage.total_tokens,
                      },
                    },
                  })}\n\n`
                );
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    // Handle non-streaming response
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const content = data.choices?.[0]?.message?.content || '';

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        content,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      })
    );
  }
}
