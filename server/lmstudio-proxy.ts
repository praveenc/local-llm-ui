import { LMStudioClient } from '@lmstudio/sdk';
import type { IncomingMessage, ServerResponse } from 'http';

// LMStudio SDK client - connects via WebSocket to LM Studio
let client: LMStudioClient | null = null;
let clientConnectionFailed = false;
let lastConnectionAttempt = 0;
const CONNECTION_RETRY_DELAY = 5000; // 5 seconds between retry attempts

async function getClient(): Promise<LMStudioClient> {
  const now = Date.now();

  // If connection previously failed, wait before retrying
  if (clientConnectionFailed && now - lastConnectionAttempt < CONNECTION_RETRY_DELAY) {
    throw new Error(
      'Cannot connect to LM Studio. Please ensure LM Studio is running with the server enabled.'
    );
  }

  if (!client) {
    lastConnectionAttempt = now;
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
    } catch (error) {
      client = null;
      clientConnectionFailed = true;
      const err = error as Error;
      console.error('LMStudio connection error:', err.message);
      throw new Error(
        'Cannot connect to LM Studio. Please ensure LM Studio is running with the server enabled.'
      );
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
    if (pathname === '/api/lmstudio-sdk/models') {
      await handleListModels(res);
    } else if (pathname === '/api/lmstudio-sdk/load') {
      await handleLoadModel(req, res);
    } else if (pathname === '/api/lmstudio-sdk/load-with-progress') {
      await handleLoadModelWithProgress(req, res);
    } else if (pathname === '/api/lmstudio-sdk/loaded') {
      await handleListLoaded(res);
    } else if (pathname === '/api/lmstudio-sdk/model-info') {
      await handleGetModelInfo(req, res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('LMStudio SDK proxy error:', error);
    const err = error as Error;

    let errorMessage = 'Internal server error';
    let statusCode = 500;

    // Check for connection-related errors
    const isConnectionError =
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('connect') ||
      err.message?.includes('WebSocket') ||
      err.message?.includes('Cannot connect to LM Studio') ||
      err.message?.includes('Failed to connect');

    if (isConnectionError) {
      errorMessage =
        'Cannot connect to LM Studio. Please ensure LM Studio is running with the server enabled.';
      statusCode = 503;
      // Reset client so next request will try to reconnect
      resetClient();
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

  console.log('LMStudio SDK: Client connected, fetching downloaded models...');

  // Get all downloaded models (not just loaded ones)
  const downloadedModels = await lmstudio.system.listDownloadedModels();

  console.log(`LMStudio SDK: Found ${downloadedModels.length} downloaded models`);
  console.log('LMStudio SDK: Raw downloaded models:', JSON.stringify(downloadedModels, null, 2));

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

  console.log(`LMStudio SDK: Returning ${models.length} LLM models`);

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models }));
}

async function handleLoadModel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { modelPath, contextLength, ttl } = JSON.parse(body);

  if (!modelPath) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'modelPath is required' }));
    return;
  }

  console.log(`LMStudio SDK: Loading model: ${modelPath}`);
  console.log(
    `LMStudio SDK: Context length: ${contextLength || 'default'}, TTL: ${ttl || 'default'}`
  );

  const lmstudio = await getClient();

  // Build load options
  const loadOptions: {
    contextLength?: number;
    ttl?: number;
  } = {};

  if (contextLength) {
    loadOptions.contextLength = contextLength;
  }

  if (ttl) {
    loadOptions.ttl = ttl;
  }

  // Use .model() which gets if loaded, or loads if not
  // This is the recommended approach from the SDK docs
  const model = await lmstudio.llm.model(modelPath, loadOptions);

  console.log(`LMStudio SDK: Model loaded successfully: ${model.identifier}`);

  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      success: true,
      identifier: model.identifier,
      modelPath,
    })
  );
}

async function handleListLoaded(res: ServerResponse): Promise<void> {
  const lmstudio = await getClient();

  // Get currently loaded models
  const loadedModels = await lmstudio.llm.listLoaded();

  console.log(`LMStudio SDK: ${loadedModels.length} models currently loaded`);

  const models = loadedModels.map((model) => ({
    identifier: model.identifier,
    modelPath: model.path,
  }));

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models }));
}

async function handleLoadModelWithProgress(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { modelPath, contextLength, ttl } = JSON.parse(body);

  if (!modelPath) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'modelPath is required' }));
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Helper to send SSE events
  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const startTime = Date.now();

  // Intercept console.log to capture progress messages
  const originalConsoleLog = console.log;
  const progressRegex = /\[LMStudioClient\]\[LLM\].*progress:\s*([0-9.]+)%/;
  const loadingStartRegex = /\[LMStudioClient\]\[LLM\].*Start loading/;
  const successRegex = /\[LMStudioClient\]\[LLM\].*Successfully loaded.*in (\d+)ms/;

  console.log = (...args: unknown[]) => {
    const message = args.join(' ');

    // Check for progress updates
    const progressMatch = message.match(progressRegex);
    if (progressMatch) {
      const percentage = parseFloat(progressMatch[1]);
      sendEvent({
        type: 'progress',
        percentage,
        message: `Loading model: ${percentage.toFixed(1)}%`,
      });
    }

    // Check for loading start
    if (loadingStartRegex.test(message)) {
      sendEvent({
        type: 'log',
        message: 'Model loading started...',
      });
    }

    // Check for success
    const successMatch = message.match(successRegex);
    if (successMatch) {
      const loadTimeMs = parseInt(successMatch[1]);
      sendEvent({
        type: 'log',
        message: `Model loaded in ${loadTimeMs}ms`,
      });
    }

    // Call original console.log
    originalConsoleLog(...args);
  };

  try {
    sendEvent({
      type: 'log',
      message: `Loading model: ${modelPath}`,
    });

    const lmstudio = await getClient();

    // Build load options
    const loadOptions: {
      contextLength?: number;
      ttl?: number;
      verbose?: boolean;
    } = {
      verbose: true, // Enable verbose logging to get progress
    };

    if (contextLength) {
      loadOptions.contextLength = contextLength;
    }

    if (ttl) {
      loadOptions.ttl = ttl;
    }

    // Load the model with verbose logging
    const model = await lmstudio.llm.model(modelPath, loadOptions);

    const loadTime = Date.now() - startTime;

    // Send success event
    sendEvent({
      type: 'success',
      identifier: model.identifier,
      modelPath,
      loadTime,
    });

    // Close the connection
    res.end();
  } catch (error) {
    const err = error as Error;
    console.error('LMStudio: Failed to load model with progress:', err);

    sendEvent({
      type: 'error',
      message: err.message || 'Failed to load model',
    });

    res.end();
  } finally {
    // Restore original console.log
    console.log = originalConsoleLog;
  }
}

async function handleGetModelInfo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { modelPath } = JSON.parse(body || '{}');

  const lmstudio = await getClient();

  // Get the model - if modelPath is provided, get that specific model
  // Otherwise get the currently loaded model
  const model = modelPath ? await lmstudio.llm.model(modelPath) : await lmstudio.llm.model();

  // Get context length from the model
  const contextLength = await model.getContextLength();

  // Get additional model info from downloaded models list
  const downloadedModels = await lmstudio.system.listDownloadedModels();
  const modelDetails = downloadedModels.find(
    (m) => m.path === model.path || m.modelKey === model.identifier
  );

  // trainedForToolUse is only available on LLM models, not embedding models
  const trainedForToolUse =
    modelDetails && modelDetails.type === 'llm' && 'trainedForToolUse' in modelDetails
      ? ((modelDetails as { trainedForToolUse?: boolean }).trainedForToolUse ?? false)
      : false;
  const displayName = modelDetails?.displayName ?? model.identifier;
  const architecture = modelDetails?.architecture;
  const paramsString = modelDetails?.paramsString;

  console.log(`LMStudio SDK: Model info for ${model.identifier}:`);
  console.log(`  - Context Length: ${contextLength}`);
  console.log(`  - Trained for Tool Use: ${trainedForToolUse}`);

  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      identifier: model.identifier,
      path: model.path,
      contextLength,
      trainedForToolUse,
      displayName,
      architecture,
      paramsString,
    })
  );
}
