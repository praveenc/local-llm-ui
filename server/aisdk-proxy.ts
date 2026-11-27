/**
 * AI SDK Proxy - Server-side streaming for Groq and Cerebras
 * (the models route also lists the models of Anthropic; its chat has its own proxy)
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
import {
  abortOnClose,
  capErrorText,
  capMaxTokens,
  endStreamWithError,
  isAbortAfterClientLeft,
  readChatRequest,
  sendJsonError,
  startEventStream,
} from './security.ts';
import { noAnswerNotice, toolErrorEvent, toolLoopOptions } from './tool-loop.ts';
import { usageEvent } from './usage.ts';
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

/** The providers that the models route lists. Anthropic only lists; its chat has its own proxy. */
type ModelsProvider = AISDKProvider | 'anthropic';

const MODELS_PROVIDERS: readonly ModelsProvider[] = ['groq', 'cerebras', 'anthropic'];

/** Longest upstream error text that goes back to the browser */
const MAX_ERROR_TEXT = 500;

/** Anthropic pages: `limit` is at most 1000, and the cap stops a loop of `has_more` */
const ANTHROPIC_PAGE_LIMIT = 1000;
const ANTHROPIC_MAX_PAGES = 5;
const ANTHROPIC_VERSION = '2023-06-01';

/** Longest wait for one upstream models call (each page of Anthropic is one call) */
const MODELS_TIMEOUT_MS = 10_000;

function getModelsEndpoint(provider: ModelsProvider): string {
  switch (provider) {
    case 'groq':
      return 'https://api.groq.com/openai/v1/models';
    case 'cerebras':
      return 'https://api.cerebras.ai/v1/models';
    case 'anthropic':
      return 'https://api.anthropic.com/v1/models';
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/** Cut the text to the cap. With the key, hide it first, in case an upstream echoes it. */
const capErrorText = (text: string, apiKey?: string): string =>
  (apiKey ? text.split(apiKey).join('[redacted]') : text).slice(0, MAX_ERROR_TEXT);

// By name: a DOMException is not always an `Error` in every runtime
const isTimeoutError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'TimeoutError';

/** The status and text that go to the browser for an error that was thrown, not answered */
function thrownErrorAnswer(error: unknown, provider: string, apiKey: string) {
  if (isTimeoutError(error)) {
    return { status: 504, message: `${provider} did not answer in time` };
  }
  return { status: 500, message: capErrorText(errorMessageOr(error, 'Unknown error'), apiKey) };
}

/** Thrown when the upstream answers with an error status; the route passes the status on */
class UpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One page of the Anthropic model list, after the shape check */
interface AnthropicPage {
  models: Array<{ id: string; name: string }>;
  hasMore: boolean;
  lastId: string | undefined;
}

function parseAnthropicPage(payload: unknown): AnthropicPage {
  const body = payload as { data?: unknown; has_more?: unknown; last_id?: unknown } | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
    throw new UpstreamError(502, 'Invalid response from Anthropic');
  }
  const models: AnthropicPage['models'] = [];
  for (const item of body.data as unknown[]) {
    const model = item as { id?: unknown; display_name?: unknown } | null;
    if (!model || typeof model !== 'object' || typeof model.id !== 'string' || !model.id) continue;
    const name =
      typeof model.display_name === 'string' && model.display_name.trim()
        ? model.display_name
        : model.id;
    models.push({ id: model.id, name });
  }
  return {
    models,
    hasMore: body.has_more === true,
    lastId: typeof body.last_id === 'string' && body.last_id ? body.last_id : undefined,
  };
}

/** Anthropic `GET /v1/models`, following `has_more` with `after_id` for a few pages */
async function fetchAnthropicModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
  const models: Array<{ id: string; name: string }> = [];
  let afterId: string | undefined;

  for (let page = 0; page < ANTHROPIC_MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(ANTHROPIC_PAGE_LIMIT) });
    if (afterId) query.set('after_id', afterId);

    const response = await fetch(`${getModelsEndpoint('anthropic')}?${query}`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new UpstreamError(
        response.status,
        capErrorText(text || 'Failed to fetch anthropic models', apiKey)
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      // A timeout while the body is read is not a bad body
      if (isTimeoutError(error)) throw error;
      throw new UpstreamError(502, 'Invalid response from Anthropic');
    }
    const result = parseAnthropicPage(payload);
    models.push(...result.models);
    if (!result.hasMore || !result.lastId) break;
    afterId = result.lastId;
  }

  return models;
}

function sendModelsJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function handleModelsRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '', 'http://localhost');
  const provider = url.searchParams.get('provider');

  if (!provider || !(MODELS_PROVIDERS as readonly string[]).includes(provider)) {
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

  if (provider === 'anthropic') {
    try {
      sendModelsJson(res, 200, { provider, models: await fetchAnthropicModels(apiKey) });
    } catch (error) {
      if (error instanceof UpstreamError) {
        sendModelsJson(res, error.status, { error: error.message });
        return;
      }
      const answer = thrownErrorAnswer(error, provider, apiKey);
      console.error(`AI SDK models proxy error (${provider}):`, answer.message);
      sendModelsJson(res, answer.status, { error: answer.message });
    }
    return;
  }

  try {
    const response = await fetch(getModelsEndpoint(provider as AISDKProvider), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: capErrorText(text, apiKey) || `Failed to fetch ${provider} models`,
        })
      );
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
    const answer = thrownErrorAnswer(error, provider, apiKey);
    console.error(`AI SDK models proxy error (${provider}):`, answer.message);
    res.statusCode = answer.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: answer.message }));
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

    // Size limit, JSON, and the fields of every chat request (SEC-07, SEC-22)
    const body = await readChatRequest(req, res);
    if (!body) return; // 413 or 400 already sent

    // Validate provider
    if (body.provider !== 'groq' && body.provider !== 'cerebras') {
      sendJsonError(res, 400, 'Invalid provider');
      return;
    }
    const request: ChatRequest = { ...body, provider: body.provider };

    // Get API key from header
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      sendJsonError(res, 401, `API key required for ${request.provider}`);
      return;
    }

    // Web search API keys and the order to try the providers in
    const webSearchProviders = getWebSearchProviders(req.headers);
    if (request.enableWebSearch && webSearchProviders.length === 0) {
      sendJsonError(res, 401, WEB_SEARCH_KEY_REQUIRED_ERROR);
      return;
    }

    let mcpCleanup: (() => Promise<void>) | undefined;
    try {
      const provider = createProvider(request.provider, apiKey);
      const startTime = Date.now();

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

      // Cancel streamText when the browser closes the connection
      const abortSignal = abortOnClose(res);

      const result = await streamText({
        model: provider(request.model),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages: request.messages,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal,
        // Send the thinking effort only for models that accept it (gpt-oss on Groq)
        ...buildReasoningParams(request.provider, request.model, request.thinkingEffort),
        // Tool loop that always ends with an answer (see tool-loop.ts)
        ...toolLoopOptions(tools, { maxSteps: request.maxToolSteps }),
      });

      // Set up SSE response
      startEventStream(res);

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
        } else if (part.type === 'tool-error') {
          res.write(toolErrorEvent(part));
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
          const streamError = capErrorText(errorMessageOr(part.error, 'Unknown error'));
          res.write(`data: ${JSON.stringify({ error: streamError })}\n\n`);
        }
      }

      // Explain a reply that ends with no answer text
      const notice = await noAnswerNotice(result);
      if (notice) res.write(`data: ${JSON.stringify({ content: notice })}\n\n`);

      // Usage of each model call and of the reply; none when the stream failed
      const usage = await usageEvent(result, startTime);
      if (usage) res.write(usage);

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
      // The browser left and the call stopped: not a proxy error, and no one to answer
      if (isAbortAfterClientLeft(error, res)) return;
      console.error(`AI SDK Proxy error (${request.provider}):`, error);

      const errorMessage = errorMessageOr(error, 'Unknown error');

      // The stream has started: report the error as an SSE event, so the chat shows it
      if (endStreamWithError(res, errorMessage)) return;

      sendJsonError(res, 500, errorMessage);
    }
  };
}
