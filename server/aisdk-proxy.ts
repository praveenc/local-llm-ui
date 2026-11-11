/**
 * AI SDK Proxy - Server-side streaming for Groq and Cerebras
 *
 * Handles chat requests using Vercel AI SDK with SSE streaming format.
 * API keys are passed from client via headers (stored in localStorage).
 * Supports an optional web search tool (Brave Search, Exa, or Tavily).
 */
import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

import type { MCPServerConfig } from '../src/types/mcp.ts';
import { errorMessageOr } from '../src/utils/errorMessage.ts';
import { buildReasoningParams } from '../src/utils/thinkingEffort.ts';
import { getMCPTools } from './mcp-manager.ts';
import { capMaxTokens, endStreamWithError, readBodyWithLimit } from './security.ts';
import { noAnswerNotice, toolLoopOptions } from './tool-loop.ts';
import {
  WEB_SEARCH_KEY_REQUIRED_ERROR,
  createWebSearchTool,
  getWebSearchProviders,
} from './web-search.ts';

type AISDKProvider = 'groq' | 'cerebras';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  provider: AISDKProvider;
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  enableWebSearch?: boolean;
  mcpServers?: MCPServerConfig[];
  thinkingEffort?: unknown;
  /** Most model calls in one reply when tools are on */
  maxToolSteps?: unknown;
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

function getModelsEndpoint(provider: AISDKProvider): string {
  switch (provider) {
    case 'groq':
      return 'https://api.groq.com/openai/v1/models';
    case 'cerebras':
      return 'https://api.cerebras.ai/v1/models';
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function handleModelsRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '', 'http://localhost');
  const provider = url.searchParams.get('provider');

  if (!provider || !['groq', 'cerebras'].includes(provider)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid or missing provider' }));
    return;
  }

  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `API key required for ${provider}` }));
    return;
  }

  try {
    const response = await fetch(getModelsEndpoint(provider as AISDKProvider), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: text || `Failed to fetch ${provider} models` }));
      return;
    }

    const payload = (await response.json()) as {
      data?: Array<{
        id: string;
        active?: boolean;
        owned_by?: string;
      }>;
    };

    const models = Array.isArray(payload.data)
      ? payload.data
          .filter((m) => m.id && (m.active === undefined || m.active))
          .map((m) => ({ id: m.id, ownedBy: m.owned_by }))
      : [];

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ provider, models }));
  } catch (error) {
    console.error(`AI SDK models proxy error (${provider}):`, error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: errorMessageOr(error, 'Unknown error') }));
  }
}

export function createAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Models discovery endpoint
    if (req.method === 'GET' && req.url?.startsWith('/api/aisdk/models')) {
      await handleModelsRequest(req, res);
      return;
    }

    // Only handle POST requests to /api/aisdk/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/aisdk/chat')) {
      return next();
    }

    // Parse request body (SEC-07: size-limited)
    const rawBody = await readBodyWithLimit(req, res);
    if (rawBody === null) return; // 413 already sent

    let request: ChatRequest;
    try {
      request = JSON.parse(rawBody);
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

    // Web search API keys and the order to try the providers in
    const webSearchProviders = getWebSearchProviders(req.headers);
    if (request.enableWebSearch && webSearchProviders.length === 0) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: WEB_SEARCH_KEY_REQUIRED_ERROR }));
      return;
    }

    let mcpCleanup: (() => Promise<void>) | undefined;
    try {
      const provider = createProvider(request.provider, apiKey);
      const startTime = Date.now();

      // Set up SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Get MCP tools if configured
      let mcpTools: Record<string, unknown> = {};
      if (request.mcpServers && request.mcpServers.length > 0) {
        const mcp = await getMCPTools(request.mcpServers);
        mcpTools = mcp.tools;
        mcpCleanup = mcp.cleanup;
      }

      // Configure tools - merge web search and MCP tools
      const allTools: ToolSet = { ...mcpTools } as ToolSet;
      if (request.enableWebSearch && webSearchProviders.length > 0) {
        allTools.webSearch = createWebSearchTool(webSearchProviders);
      }
      const tools = Object.keys(allTools).length > 0 ? allTools : undefined;

      // Create abort controller to cancel streamText when client disconnects
      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      const result = await streamText({
        model: provider(request.model),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages: request.messages,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal: abortController.signal,
        // Send the thinking effort only for models that accept it (gpt-oss on Groq)
        ...buildReasoningParams(request.provider, request.model, request.thinkingEffort),
        // Tool loop that always ends with an answer (see tool-loop.ts)
        ...toolLoopOptions(tools, { maxSteps: request.maxToolSteps }),
      });

      // Stream text chunks and handle tool calls
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          res.write(`data: ${JSON.stringify({ content: part.text })}\n\n`);
        } else if (part.type === 'reasoning-delta') {
          res.write(`data: ${JSON.stringify({ reasoning: part.text })}\n\n`);
        } else if (part.type === 'tool-call') {
          res.write(
            `data: ${JSON.stringify({
              toolCall: {
                id: part.toolCallId,
                name: part.toolName,
                args: 'input' in part ? part.input : {},
              },
            })}\n\n`
          );
        } else if (part.type === 'tool-result') {
          res.write(
            `data: ${JSON.stringify({
              toolResult: {
                id: part.toolCallId,
                name: part.toolName,
                result: 'output' in part ? part.output : part,
              },
            })}\n\n`
          );
        } else if (part.type === 'error') {
          const streamError = errorMessageOr(part.error, 'Unknown error');
          res.write(`data: ${JSON.stringify({ error: streamError })}\n\n`);
        }
      }

      // Explain a reply that ends with no answer text
      const notice = await noAnswerNotice(result);
      if (notice) res.write(`data: ${JSON.stringify({ content: notice })}\n\n`);

      // Get usage after the stream completes
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

      // Clean up stale MCP clients
      if (mcpCleanup) {
        mcpCleanup().catch((err: unknown) => console.warn('[MCP] Cleanup error:', err));
      }
    } catch (error) {
      // Clean up MCP clients on error too
      if (mcpCleanup) {
        mcpCleanup().catch((err: unknown) => console.warn('[MCP] Cleanup error:', err));
      }
      console.error(`AI SDK Proxy error (${request.provider}):`, error);

      const errorMessage = errorMessageOr(error, 'Unknown error');

      // The stream has started: report the error as an SSE event, so the chat shows it
      if (endStreamWithError(res, errorMessage)) return;

      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: errorMessage }));
    }
  };
}
