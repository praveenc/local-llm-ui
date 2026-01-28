/**
 * AI SDK Proxy - Server-side streaming for Groq and Cerebras
 *
 * Handles chat requests using Vercel AI SDK with SSE streaming format.
 * API keys are passed from client via headers (stored in localStorage).
 */
import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';
import type { Connect } from 'vite';

type AISDKProvider = 'groq' | 'cerebras';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  provider: AISDKProvider;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

function createProvider(providerType: AISDKProvider, apiKey: string) {
  switch (providerType) {
    case 'groq':
      return createGroq({ apiKey });
    case 'cerebras':
      return createCerebras({ apiKey });
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }
}

export function createAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/aisdk/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/aisdk/chat')) {
      return next();
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let request: ChatRequest;
    try {
      request = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Get API key from header
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `API key required for ${request.provider}` }));
      return;
    }

    // Validate provider
    if (!['groq', 'cerebras'].includes(request.provider)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Invalid provider: ${request.provider}` }));
      return;
    }

    try {
      const provider = createProvider(request.provider, apiKey);
      const startTime = Date.now();

      // Set up SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const result = await streamText({
        model: provider(request.model),
        messages: request.messages,
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        topP: request.top_p,
      });

      // Stream text chunks
      for await (const chunk of result.textStream) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // Get usage data after stream completes
      const usage = await result.usage;
      const latencyMs = Date.now() - startTime;

      // Send metadata
      res.write(
        `data: ${JSON.stringify({
          metadata: {
            usage: {
              inputTokens: usage?.inputTokens || 0,
              outputTokens: usage?.outputTokens || 0,
              totalTokens: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
            },
            latencyMs,
          },
        })}\n\n`
      );

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error(`AI SDK Proxy error (${request.provider}):`, error);

      // If headers already sent, we can't change status code
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.end(JSON.stringify({ error: errorMessage }));
    }
  };
}
