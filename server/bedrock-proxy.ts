import type { IncomingMessage, ServerResponse } from 'http';
import {
  BedrockClient,
  ListInferenceProfilesCommand,
  InferenceProfileType,
  type ListInferenceProfilesCommandInput,
} from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';



interface InferenceProfileModel {
  modelArn?: string;
  modelName?: string;
}

interface InferenceProfileSummary {
  inferenceProfileId?: string;
  inferenceProfileName?: string;
  status?: string;
  type?: string;
  description?: string;
  models?: InferenceProfileModel[];
  createdAt?: Date;
  lastUpdatedAt?: Date;
}

// Initialize clients with credentials from environment
const clientOptions = {
  region: process.env.AWS_REGION || process.env.VITE_AWS_REGION || 'us-west-2',
};

const bedrockClient = new BedrockClient(clientOptions);
const bedrockRuntimeClient = new BedrockRuntimeClient(clientOptions);

export async function handleBedrockRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    if (pathname === '/api/bedrock/models') {
      await handleListModels(res);
    } else if (pathname === '/api/bedrock/chat') {
      await handleChat(req, res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('Bedrock proxy error:', error);
    const err = error as Error;

    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (
      err.name === 'CredentialsProviderError' ||
      err.message?.includes('CredentialsProviderError') ||
      err.message?.includes('Could not load credentials')
    ) {
      errorMessage =
        'AWS credentials not found. Please configure AWS credentials in your environment.';
      statusCode = 401;
    } else if (err.name === 'AccessDeniedException' || err.message?.includes('Access Denied')) {
      errorMessage = 'Access denied to Amazon Bedrock. Check IAM permissions.';
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

async function handleListModels(res: ServerResponse): Promise<void> {
  let allProfiles: InferenceProfileSummary[] = [];
  let nextToken: string | undefined;

  // Paginate through all inference profiles
  do {
    const listProfilesInput: ListInferenceProfilesCommandInput = {
      maxResults: 100,
      typeEquals: InferenceProfileType.SYSTEM_DEFINED,
      nextToken,
    };

    const command = new ListInferenceProfilesCommand(listProfilesInput);
    const response = await bedrockClient.send(command);

    allProfiles = allProfiles.concat(response.inferenceProfileSummaries || []);
    nextToken = response.nextToken;
  } while (nextToken);

  console.log(
    `Bedrock: Found ${allProfiles.length} total inference profiles`
  );

  const filteredProfiles = allProfiles.filter(
    (profile: InferenceProfileSummary) => {
      if (!profile.models || profile.models.length === 0) {
        return false;
      }

      const modelArn = profile.models[0].modelArn || '';

      // Only exclude embedding models and image models
      if (
        modelArn.toLowerCase().includes('embed') ||
        modelArn.toLowerCase().includes('stable-image') ||
        modelArn.toLowerCase().includes('twelvelabs')
      ) {
        return false;
      }

      return true;
    }
  );

  const mappedModels = filteredProfiles.map((profile: InferenceProfileSummary) => {
    const displayName = profile.inferenceProfileName || profile.inferenceProfileId || '';
    const modelId = profile.inferenceProfileId || '';

    return {
      modelId,
      modelName: displayName,
      provider: 'bedrock',
    };
  });

  const uniqueModels = Array.from(
    new Map(mappedModels.map((model) => [model.modelId, model])).values()
  );

  // Add hardcoded models that aren't available via inference profiles
  const hardcodedModels: Array<{ modelId: string; modelName: string; provider: string }> = [
    // TODO: Add 1m context window models when beta header support is fully implemented
  ];

  // Merge hardcoded models with discovered models
  const allModels = [...uniqueModels, ...hardcodedModels];

  // Sort models: Anthropic first, then alphabetically by name
  allModels.sort((a, b) => {
    const aIsAnthropic = a.modelName.toLowerCase().includes('anthropic') || a.modelName.toLowerCase().includes('claude');
    const bIsAnthropic = b.modelName.toLowerCase().includes('anthropic') || b.modelName.toLowerCase().includes('claude');

    // Anthropic models first
    if (aIsAnthropic && !bIsAnthropic) return -1;
    if (!aIsAnthropic && bIsAnthropic) return 1;

    // Then alphabetically
    return a.modelName.localeCompare(b.modelName);
  });

  console.log(`Bedrock: Returning ${allModels.length} unique models (sorted, including ${hardcodedModels.length} hardcoded)`);

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models: allModels }));
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { model, messages, temperature, max_tokens, top_p } = JSON.parse(body);

  console.log(`Bedrock: Chat request for model: ${model}`);
  console.log(`Bedrock: Messages count: ${messages?.length || 0}`);

  // Claude Sonnet 4.5 and Haiku 4.5 don't support both temperature and topP simultaneously
  // Check if model contains 'sonnet-4-5' or 'haiku-4-5' in the ID
  const shouldOmitTopP = model.includes('sonnet-4-5') || model.includes('haiku-4-5');

  const inferenceConfig: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  } = {
    temperature: temperature ?? 0.7,
    maxTokens: max_tokens ?? 2048,
  };

  // Only include topP for models that support it alongside temperature
  if (!shouldOmitTopP) {
    inferenceConfig.topP = top_p ?? 0.9;
  }

  // Transform messages to support documents
  const transformedMessages = messages.map((msg: any) => {
    const role = msg.role === 'user' ? 'user' : 'assistant';

    // Build content blocks
    const contentBlocks: any[] = [];

    // Add text content
    if (typeof msg.content === 'string') {
      contentBlocks.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Content is already in ContentBlock format
      contentBlocks.push(...msg.content);
    }

    // Add document blocks if files are present
    if (msg.files && Array.isArray(msg.files)) {
      for (const file of msg.files) {
        contentBlocks.push({
          document: {
            name: file.name,
            format: file.format,
            source: {
              bytes: Buffer.from(file.bytes, 'base64'),
            },
          },
        });
      }
    }

    return {
      role,
      content: contentBlocks,
    };
  });

  const command = new ConverseStreamCommand({
    modelId: model,
    messages: transformedMessages,
    inferenceConfig,
  });

  const response = await bedrockRuntimeClient.send(command);

  if (!response.stream) {
    throw new Error('No stream in response');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let metadata: { usage?: unknown; metrics?: unknown } | null = null;

  for await (const event of response.stream) {
    if (event.contentBlockDelta?.delta?.text) {
      res.write(`data: ${JSON.stringify({ content: event.contentBlockDelta.delta.text })}\n\n`);
    }

    // Capture metadata from the stream
    if (event.metadata) {
      metadata = {
        usage: event.metadata.usage,
        metrics: event.metadata.metrics,
      };
    }
  }

  // Send metadata at the end
  if (metadata) {
    res.write(`data: ${JSON.stringify({ metadata })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
