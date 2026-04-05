/**
 * OpenRouter AI SDK Proxy - Server-side streaming using @ai-sdk/openai-compatible
 *
 * Handles OpenRouter model discovery and chat requests using Vercel AI SDK.
 * API key is passed from the client via X-Api-Key header.
 * Supports Tavily web search, MCP tools, reasoning deltas, and SSE streaming.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { tavilySearch } from '@tavily/ai-sdk';
import { stepCountIs, streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

import type { MCPServerConfig } from '../src/types/mcp';
import { getMCPTools } from './mcp-manager';
import { capMaxTokens, readBodyWithLimit, setCORSHeaders } from './security';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  enableWebSearch?: boolean;
  mcpServers?: MCPServerConfig[];
}

interface OpenRouterModelsResponse {
  data?: Array<{
    id: string;
    name: string;
    description?: string;
    context_length?: number;
    pricing?: {
      prompt: number;
      completion: number;
    };
  }>;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;

  const message = value as Record<string, unknown>;
  return (
    (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
    typeof message.content === 'string'
  );
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== 'object') return false;

  const request = value as Record<string, unknown>;
  return typeof request.model === 'string' && Array.isArray(request.messages);
}

function parseJsonSafely(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractApiErrorMessage(payload: unknown, fallback: string): string {
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

      return trimmed;
    }

    if (typeof value === 'object') {
      if (visited.has(value)) return undefined;
      visited.add(value);

      const obj = value as Record<string, unknown>;
      return (
        walk(obj.error) ||
        walk(obj.message) ||
        walk(obj.detail) ||
        walk(obj.details) ||
        walk(obj.data)
      );
    }

    return undefined;
  };

  return walk(payload) || fallback;
}

function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const err = error as {
      name?: string;
      cause?: unknown;
      responseBody?: unknown;
      body?: unknown;
    };

    if (err.name === 'AbortError') {
      return 'Request was cancelled.';
    }

    const nestedMessage =
      extractApiErrorMessage(err.responseBody, '') ||
      extractApiErrorMessage(err.body, '') ||
      extractApiErrorMessage(err.cause, '');

    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return fallback;
}

async function handleModelsRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'OpenRouter API key required' }));
    return;
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const parsed = parseJsonSafely(bodyText);

      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: extractApiErrorMessage(parsed ?? bodyText, 'Failed to fetch OpenRouter models'),
        })
      );
      return;
    }

    const payload = (await response.json()) as OpenRouterModelsResponse;
    const models = Array.isArray(payload.data)
      ? payload.data
          .filter((model) => typeof model.id === 'string' && model.id.length > 0)
          .map((model) => ({
            id: model.id,
            name: model.name || model.id,
          }))
      : [];

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ provider: 'openrouter', models }));
  } catch (error) {
    console.error('OpenRouter models proxy error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: getSafeErrorMessage(error, 'Failed to fetch OpenRouter models'),
      })
    );
  }
}

export function createOpenRouterAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const pathname = new URL(req.url || '', 'http://localhost').pathname;

    if (!pathname.startsWith('/api/openrouter/')) {
      return next();
    }

    setCORSHeaders(req, res, 'Content-Type, X-Api-Key, X-Tavily-Api-Key');

    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/openrouter/models') {
      await handleModelsRequest(req, res);
      return;
    }

    if (req.method !== 'POST' || pathname !== '/api/openrouter/chat') {
      return next();
    }

    const rawBody = await readBodyWithLimit(req, res);
    if (rawBody === null) return;

    let parsedRequest: unknown;
    try {
      parsedRequest = JSON.parse(rawBody);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!isChatRequest(parsedRequest)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid chat request' }));
      return;
    }

    const request = parsedRequest;

    if (!request.model.trim()) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Model is required' }));
      return;
    }

    if (!request.messages.every(isChatMessage)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid messages array' }));
      return;
    }

    if (request.temperature !== undefined && typeof request.temperature !== 'number') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'temperature must be a number' }));
      return;
    }

    if (request.top_p !== undefined && typeof request.top_p !== 'number') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'top_p must be a number' }));
      return;
    }

    if (request.max_tokens !== undefined && typeof request.max_tokens !== 'number') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'max_tokens must be a number' }));
      return;
    }

    if (request.enableWebSearch !== undefined && typeof request.enableWebSearch !== 'boolean') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'enableWebSearch must be a boolean' }));
      return;
    }

    if (request.mcpServers !== undefined && !Array.isArray(request.mcpServers)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'mcpServers must be an array' }));
      return;
    }

    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'OpenRouter API key required' }));
      return;
    }

    const tavilyApiKey = req.headers['x-tavily-api-key'] as string | undefined;
    if (request.enableWebSearch && !tavilyApiKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Tavily API key required for web search' }));
      return;
    }

    let mcpCleanup: (() => Promise<void>) | undefined;
    try {
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        includeUsage: true,
      });
      const startTime = Date.now();

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let mcpTools: Record<string, unknown> = {};
      if (request.mcpServers && request.mcpServers.length > 0) {
        const mcp = await getMCPTools(request.mcpServers);
        mcpTools = mcp.tools;
        mcpCleanup = mcp.cleanup;
      }

      const allTools: ToolSet = { ...mcpTools } as ToolSet;
      if (request.enableWebSearch && tavilyApiKey) {
        allTools.webSearch = tavilySearch({ apiKey: tavilyApiKey });
      }
      const tools = Object.keys(allTools).length > 0 ? allTools : undefined;

      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      const filteredMessages = request.messages.filter(
        (message) => message.content.trim().length > 0
      );
      if (filteredMessages.length === 0) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'At least one non-empty message is required' }));
        return;
      }

      const result = await streamText({
        model: openrouter(request.model),
        messages: filteredMessages,
        temperature: request.temperature ?? 0.3,
        topP: request.top_p ?? 0.95,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal: abortController.signal,
        ...(tools && { stopWhen: stepCountIs(5) }),
      });

      for await (const part of result.fullStream) {
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
          res.write(
            `data: ${JSON.stringify({
              error: getSafeErrorMessage(part.error, 'OpenRouter streaming error'),
            })}\n\n`
          );
        }
      }

      const usage = await result.usage;
      const latencyMs = Date.now() - startTime;

      res.write(
        `data: ${JSON.stringify({
          metadata: {
            usage: {
              inputTokens: usage?.inputTokens || 0,
              outputTokens: usage?.outputTokens || 0,
              totalTokens: usage?.totalTokens || 0,
            },
            latencyMs,
          },
        })}\n\n`
      );

      res.write('data: [DONE]\n\n');
      res.end();

      if (mcpCleanup) {
        mcpCleanup().catch((err: unknown) => console.warn('[MCP] Cleanup error:', err));
      }
    } catch (error) {
      if (mcpCleanup) {
        mcpCleanup().catch((err: unknown) => console.warn('[MCP] Cleanup error:', err));
      }

      console.error('OpenRouter AI SDK Proxy error:', error);

      const errorMessage = getSafeErrorMessage(error, 'OpenRouter request failed');

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
