import {
  BedrockClient,
  InferenceProfileType,
  ListInferenceProfilesCommand,
  type ListInferenceProfilesCommandInput,
} from '@aws-sdk/client-bedrock';
import type { IncomingMessage, ServerResponse } from 'http';

import { setCORSHeaders } from './security.ts';

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

export async function handleBedrockRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Set CORS headers (SEC-05: restricted to dev server origins)
  setCORSHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    if (pathname === '/api/bedrock/models') {
      await handleListModels(res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    const err = error as Error;

    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (
      err.name === 'CredentialsProviderError' ||
      err.message?.includes('CredentialsProviderError') ||
      err.message?.includes('Could not load credentials')
    ) {
      console.warn('[Bedrock] Model discovery unavailable — AWS credentials are not configured.');
      errorMessage =
        'AWS credentials not found. Please configure AWS credentials in your environment.';
      statusCode = 401;
    } else if (err.name === 'AccessDeniedException' || err.message?.includes('Access Denied')) {
      console.warn('[Bedrock] Model discovery unavailable — access to Amazon Bedrock was denied.');
      errorMessage = 'Access denied to Amazon Bedrock. Check IAM permissions.';
      statusCode = 403;
    } else {
      console.error('Bedrock proxy error:', error);
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

  console.log(`Bedrock: Found ${allProfiles.length} total inference profiles`);

  const filteredProfiles = allProfiles.filter((profile: InferenceProfileSummary) => {
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
  });

  const mappedModels = filteredProfiles.map((profile: InferenceProfileSummary) => {
    const displayName = profile.inferenceProfileName || profile.inferenceProfileId || '';
    const modelId = profile.inferenceProfileId || '';
    const profileType = profile.type || 'UNKNOWN';

    // Extract model family from the model name or ARN
    let modelFamily = 'Other';
    const lowerName = displayName.toLowerCase();
    const modelArn = profile.models?.[0]?.modelArn?.toLowerCase() || '';

    if (
      lowerName.includes('claude') ||
      lowerName.includes('anthropic') ||
      modelArn.includes('anthropic')
    ) {
      modelFamily = 'Anthropic Claude';
    } else if (lowerName.includes('llama') || modelArn.includes('meta')) {
      modelFamily = 'Meta Llama';
    } else if (lowerName.includes('mistral') || modelArn.includes('mistral')) {
      modelFamily = 'Mistral AI';
    } else if (lowerName.includes('titan') || modelArn.includes('amazon')) {
      modelFamily = 'Amazon Titan';
    } else if (lowerName.includes('jamba') || modelArn.includes('ai21')) {
      modelFamily = 'AI21 Labs';
    } else if (lowerName.includes('command') || modelArn.includes('cohere')) {
      modelFamily = 'Cohere';
    }

    return {
      modelId,
      modelName: displayName,
      provider: 'bedrock',
      profileType, // SYSTEM_DEFINED type (can be used to determine global vs regional)
      modelFamily,
    };
  });

  const uniqueModels = Array.from(
    new Map(mappedModels.map((model) => [model.modelId, model])).values()
  );

  const allModels = uniqueModels;

  // Sort models: Anthropic first, then alphabetically by name
  allModels.sort((a, b) => {
    const aIsAnthropic =
      a.modelName.toLowerCase().includes('anthropic') ||
      a.modelName.toLowerCase().includes('claude');
    const bIsAnthropic =
      b.modelName.toLowerCase().includes('anthropic') ||
      b.modelName.toLowerCase().includes('claude');

    // Anthropic models first
    if (aIsAnthropic && !bIsAnthropic) return -1;
    if (!aIsAnthropic && bIsAnthropic) return 1;

    // Then alphabetically
    return a.modelName.localeCompare(b.modelName);
  });

  console.log(`Bedrock: Returning ${allModels.length} unique models (sorted)`);

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models: allModels }));
}
