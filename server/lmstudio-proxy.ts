import { LMStudioClient } from '@lmstudio/sdk';
import type { IncomingMessage, ServerResponse } from 'http';

import { setCORSHeaders } from './security.ts';

// LMStudio SDK client - connects via WebSocket to LM Studio
let client: LMStudioClient | null = null;
let clientConnectionFailed = false;
let lastConnectionAttempt = 0;
const CONNECTION_RETRY_DELAY = 5000; // 5 seconds between retry attempts
const LMSTUDIO_HTTP_MODELS_URL = 'http://127.0.0.1:1234/v1/models';

async function isLMStudioReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(LMSTUDIO_HTTP_MODELS_URL, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok || response.status >= 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function getClient(): Promise<LMStudioClient> {
  const now = Date.now();

  // If connection previously failed, wait before retrying
  if (clientConnectionFailed && now - lastConnectionAttempt < CONNECTION_RETRY_DELAY) {
    throw new Error('LM Studio is not connected. Start LM Studio and enable its local server.');
  }

  if (!client) {
    lastConnectionAttempt = now;

    const isReachable = await isLMStudioReachable();
    if (!isReachable) {
      clientConnectionFailed = true;
      throw new Error('LM Studio is not connected. Start LM Studio and enable its local server.');
    }

    try {
      // Create client with error handling
      client = new LMStudioClient({
        // Use default localhost connection
        baseUrl: 'ws://127.0.0.1:1234',
      });
      // Test the connection by making a simple call with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
      await Promise.race([client.system.listDownloadedModels(), timeoutPromise]);
      clientConnectionFailed = false;
    } catch {
      client = null;
      clientConnectionFailed = true;
      throw new Error('LM Studio is not connected. Start LM Studio and enable its local server.');
    }
  }
  return client;
}

// Reset client on connection errors (allows retry)
function resetClient(): void {
  client = null;
  clientConnectionFailed = false;
}

export async function handleLMStudioRequest(
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
    if (pathname === '/api/lmstudio-sdk/models') {
      await handleListModels(res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    const err = error as Error;

    let errorMessage = 'Internal server error';
    let statusCode = 500;

    // Check for connection-related errors
    const isConnectionError =
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('connect') ||
      err.message?.includes('WebSocket') ||
      err.message?.includes('Cannot connect to LM Studio') ||
      err.message?.includes('LM Studio is not connected') ||
      err.message?.includes('Failed to connect');

    if (isConnectionError) {
      console.warn('[LMStudio] Model discovery unavailable — local server is not connected.');
      errorMessage = 'LM Studio is not connected. Start LM Studio and enable its local server.';
      statusCode = 503;
      // Reset client so next request will try to reconnect
      resetClient();
    } else {
      console.error('LMStudio SDK proxy error:', error);
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
  const lmstudio = await getClient();

  // Get all downloaded models (not just loaded ones)
  const downloadedModels = await lmstudio.system.listDownloadedModels();

  // Filter out embedding models and map to our format
  const models = downloadedModels
    .filter((model) => model.type === 'llm')
    .map((model) => ({
      modelId: model.path,
      modelName: model.displayName || model.path,
      modelKey: model.modelKey,
      provider: 'lmstudio',
      maxContextLength: model.maxContextLength,
      architecture: model.architecture,
      paramsString: model.paramsString,
    }));

  console.log(`LMStudio SDK: Found ${models.length} LLM models`);

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models }));
}
