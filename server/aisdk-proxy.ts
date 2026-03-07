/**
 * AI SDK Proxy - Server-side streaming for Groq and Cerebras
 *
 * Handles chat requests using Vercel AI SDK with SSE streaming format.
 * API keys are passed from client via headers (stored in localStorage).
 * Supports optional Tavily web search tool integration.
 */
import { createCerebras } from '@ai-sdk/cerebras';
import { createGroq } from '@ai-sdk/groq';
import { tavilySearch } from '@tavily/ai-sdk';
import { stepCountIs, streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

import type { MCPServerConfig } from '../src/types/mcp';
import { getMCPTools } from './mcp-manager';
import { capMaxTokens, readBodyWithLimit } from './security';

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
  enableWebSearch?: boolean;
  mcpServers?: MCPServerConfig[];
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

function parseJsonSafely(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractErrorMessage(error: unknown): string {
  const GENERIC_ERRORS = new Set([
    'No output generated.',
    'No output generated. Check the stream for errors.',
    'Unknown error',
  ]);
  const visited = new Set<unknown>();

  const walk = (value: unknown): string | undefined => {
    if (value == null) return undefined;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;

      const parsed = parseJsonSafely(trimmed);
      if (parsed && parsed !== value) {
        return walk(parsed);
      }

      return GENERIC_ERRORS.has(trimmed) ? undefined : trimmed;
    }

    if (value instanceof Error) {
      const withFields = value as Error & {
        cause?: unknown;
        responseBody?: unknown;
      };

      return (
        walk(withFields.responseBody) ||
        walk(withFields.cause) ||
        (!GENERIC_ERRORS.has(value.message) ? value.message : undefined)
      );
    }

    if (typeof value === 'object') {
      if (visited.has(value)) return undefined;
      visited.add(value);

      const obj = value as Record<string, unknown>;

      return (
        walk(obj.error) ||
        walk(obj.message) ||
        walk(obj.responseBody) ||
        walk(obj.cause) ||
        walk(obj.details) ||
        walk(obj.detail) ||
        walk(obj.data)
      );
    }

    return undefined;
  };

  return walk(error) || (error instanceof Error ? error.message : 'Unknown error');
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
    res.end(JSON.stringify({ error: extractErrorMessage(error) }));
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

    // Get Tavily API key if web search is enabled
    const tavilyApiKey = req.headers['x-tavily-api-key'] as string;
    if (request.enableWebSearch && !tavilyApiKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Tavily API key required for web search' }));
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
      if (request.enableWebSearch && tavilyApiKey) {
        allTools.webSearch = tavilySearch({ apiKey: tavilyApiKey });
      }
      const tools = Object.keys(allTools).length > 0 ? allTools : undefined;

      // Create abort controller to cancel streamText when client disconnects
      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      const result = await streamText({
        model: provider(request.model),
        messages: request.messages,
        temperature: request.temperature,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        topP: request.top_p,
        tools,
        abortSignal: abortController.signal,
        // stopWhen required for multi-step tool use (agentic behavior)
        ...(tools && { stopWhen: stepCountIs(5) }),
      });

      // Stream text chunks and handle tool calls
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          res.write(`data: ${JSON.stringify({ content: part.text })}\n\n`);
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
          const streamError = extractErrorMessage(part.error);
          res.write(`data: ${JSON.stringify({ error: streamError })}\n\n`);
        }
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

      const errorMessage = extractErrorMessage(error);

      // If headers already sent, respond in SSE format so the client can parse it.
      if (res.headersSent) {
        try {
          res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } catch {
          res.end();
        }
        return;
      }

      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: errorMessage }));
    }
  };
}
