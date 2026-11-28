/**
 * OpenRouter AI SDK Proxy - Server-side streaming using @ai-sdk/openai-compatible
 *
 * Handles OpenRouter model discovery and chat requests using Vercel AI SDK.
 * API key is passed from the client via X-Api-Key header.
 * Supports web search (Brave Search, Exa, or Tavily), MCP tools, reasoning deltas, and SSE streaming.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

import { errorMessageOr, extractErrorMessage } from '../src/utils/errorMessage.ts';
import { buildReasoningParams } from '../src/utils/thinkingEffort.ts';
import { WEB_SEARCH_HEADER_NAMES } from '../src/utils/webSearch.ts';
import { getMCPTools } from './mcp-manager.ts';
import { hasPdf, modelMessagesOr400 } from './model-messages.ts';
import {
  abortOnClose,
  capErrorText,
  capMaxTokens,
  endStreamWithError,
  isAbortAfterClientLeft,
  readChatRequest,
  sendJsonError,
  setCORSHeaders,
  startEventStream,
} from './security.ts';
import { noAnswerNotice, toolErrorEvent, toolLoopOptions } from './tool-loop.ts';
import { usageEvent } from './usage.ts';
import {
  WEB_SEARCH_KEY_REQUIRED_ERROR,
  createWebSearchTool,
  getWebSearchProviders,
} from './web-search.ts';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** OpenRouter model ids: `vendor/model`, with an optional `:variant` (Q8: stricter than other proxies) */
const MODEL_ID_PATTERN = /^[a-zA-Z0-9._\-/:@]+$/;

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
    architecture?: { input_modalities?: unknown };
  }>;
}

/** The input modalities of a model, as strings only */
function inputModalitiesOf(model: { architecture?: { input_modalities?: unknown } }): string[] {
  const list = model.architecture?.input_modalities;
  return Array.isArray(list) ? list.filter((m): m is string => typeof m === 'string') : [];
}

/** How long the server keeps OpenRouter's model list for the PDF choice */
const MODALITIES_TTL_MS = 60 * 60 * 1000;
let modalitiesCache: { at: number; byModel: Map<string, string[]> } | null = null;

function storeModalities(payload: OpenRouterModelsResponse): void {
  if (!Array.isArray(payload.data)) return;
  const byModel = new Map<string, string[]>();
  for (const model of payload.data) {
    if (typeof model.id === 'string') byModel.set(model.id, inputModalitiesOf(model));
  }
  modalitiesCache = { at: Date.now(), byModel };
}

/** How long a failed list fetch is remembered: no new fetch, and the free parser, in that time */
const LIST_FAILURE_TTL_MS = 60 * 1000;
let listFailedAt: number | null = null;

/** For tests: forget the kept model list and a failed fetch */
export function clearOpenRouterModalitiesCache(): void {
  modalitiesCache = null;
  listFailedAt = null;
}

/**
 * The input modalities of `modelId` from the server's own copy of OpenRouter's model list
 * (fetched again after an hour). Empty when the list cannot load or has no such model. A failed
 * fetch is remembered for 60 s, so later requests do not wait on the list again.
 */
async function modelInputModalities(modelId: string, apiKey: string): Promise<string[]> {
  if (listFailedAt !== null && Date.now() - listFailedAt < LIST_FAILURE_TTL_MS) return [];
  if (!modalitiesCache || Date.now() - modalitiesCache.at > MODALITIES_TTL_MS) {
    let loaded = false;
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        storeModalities((await response.json()) as OpenRouterModelsResponse);
        loaded = true;
      }
    } catch {
      // No list: the model counts as one that cannot read files, so the free parser runs
    }
    if (!loaded) {
      listFailedAt = Date.now();
      modalitiesCache = null;
      return [];
    }
    listFailedAt = null;
  }
  return modalitiesCache?.byModel.get(modelId) ?? [];
}

/**
 * The provider options for a PDF. OpenRouter parses a PDF for a model that cannot read files,
 * and its default parser is paid OCR. The app never starts a paid parser by itself: a model
 * without `file` in its input modalities gets the free `cloudflare-ai` engine; a model with it
 * gets the `native` engine, so a route that cannot read the PDF fails instead of falling back
 * to paid OCR.
 */
export async function pdfProviderOptions(
  modelId: string,
  apiKey: string
): Promise<{ openrouter: { plugins: Array<{ id: string; pdf: { engine: string } }> } }> {
  const modalities = await modelInputModalities(modelId, apiKey);
  const engine = modalities.includes('file') ? 'native' : 'cloudflare-ai';
  return { openrouter: { plugins: [{ id: 'file-parser', pdf: { engine } }] } };
}

function parseJsonSafely(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractOpenRouterError(rawBody: string): string | null {
  const parsed = parseJsonSafely(rawBody);
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  const error = obj.error as Record<string, unknown> | undefined;
  if (!error) return null;

  const metadata = error.metadata as Record<string, unknown> | undefined;
  const message = error.message as string | undefined;

  if (metadata) {
    const providerName = metadata.provider_name as string | undefined;
    const raw = metadata.raw as string | undefined;
    if (raw?.toLowerCase().includes('<!doctype html') || raw?.includes('403')) {
      return providerName
        ? `${providerName} provider blocked the request (403). Try a different model.`
        : 'Provider blocked the request (403). Try a different model.';
    }
    if (providerName && message) {
      return `${providerName}: ${message}`;
    }
  }

  const code = error.code as number | undefined;
  if (message) return code ? `${message} (code: ${code})` : message;
  return null;
}

function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const err = error as {
      name?: string;
      cause?: unknown;
      responseBody?: unknown;
      body?: unknown;
      statusCode?: number;
      rawResponse?: { body?: string };
    };

    if (err.name === 'AbortError') {
      return 'Request was cancelled.';
    }

    // Extract from raw response body (OpenRouter JSON with provider errors)
    if (typeof err.responseBody === 'string' && err.responseBody.length > 0) {
      const msg = extractOpenRouterError(err.responseBody);
      if (msg) return msg;
    }

    // AI SDK: rawResponse.body
    if (typeof err.rawResponse?.body === 'string') {
      const msg = extractOpenRouterError(err.rawResponse.body);
      if (msg) return msg;
    }

    const nestedMessage =
      extractErrorMessage(err.responseBody) ||
      extractErrorMessage(err.body) ||
      extractErrorMessage(err.cause);

    if (nestedMessage) {
      return nestedMessage;
    }

    // Last resort: status-based generic messages
    if (err.statusCode === 403) {
      return 'Model provider blocked this request (403). Try a different model.';
    }
    if (err.statusCode === 401) {
      return 'Invalid OpenRouter API key.';
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
          error: capErrorText(
            errorMessageOr(parsed ?? bodyText, 'Failed to fetch OpenRouter models')
          ),
        })
      );
      return;
    }

    const payload = (await response.json()) as OpenRouterModelsResponse;
    storeModalities(payload);
    const models = Array.isArray(payload.data)
      ? payload.data
          .filter((model) => typeof model.id === 'string' && model.id.length > 0)
          .map((model) => ({
            id: model.id,
            name: model.name || model.id,
            inputModalities: inputModalitiesOf(model),
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
        error: capErrorText(getSafeErrorMessage(error, 'Failed to fetch OpenRouter models')),
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

    setCORSHeaders(req, res, `Content-Type, X-Api-Key, ${WEB_SEARCH_HEADER_NAMES}`);

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

    // Size limit, JSON, and the fields of every chat request (SEC-07, SEC-22)
    const request = await readChatRequest(req, res);
    if (!request) return; // 413 or 400 already sent

    // The files as this provider's parts (D-A c); a type that it cannot take is a 400
    const messages = modelMessagesOr400(res, request.messages, 'openrouter');
    if (!messages) return; // 400 already sent

    if (!MODEL_ID_PATTERN.test(request.model)) {
      sendJsonError(res, 400, 'Invalid model ID format');
      return;
    }

    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      sendJsonError(res, 401, 'OpenRouter API key required');
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
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        includeUsage: true,
      });
      const startTime = Date.now();

      let mcpTools: Record<string, unknown> = {};
      if (request.mcpServers && request.mcpServers.length > 0) {
        const mcp = await getMCPTools(request.mcpServers);
        mcpTools = mcp.tools;
        mcpCleanup = mcp.cleanup;
      }

      const allTools: ToolSet = { ...mcpTools } as ToolSet;
      if (request.enableWebSearch && webSearchProviders.length > 0) {
        allTools.webSearch = createWebSearchTool(webSearchProviders);
      }
      const tools = Object.keys(allTools).length > 0 ? allTools : undefined;

      // Cancel streamText when the browser closes the connection
      const abortSignal = abortOnClose(res);

      // A PDF for a model that cannot read files: the free parser, never the paid default
      const providerOptions = hasPdf(request.messages)
        ? await pdfProviderOptions(request.model, apiKey)
        : undefined;

      const result = await streamText({
        model: openrouter(request.model),
        ...(providerOptions && { providerOptions }),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal,
        // Sent to OpenRouter as reasoning_effort, only for models that accept it
        ...buildReasoningParams('openrouter', request.model, request.thinkingEffort),
        // Tool loop that always ends with an answer (see tool-loop.ts)
        ...toolLoopOptions(tools, { maxSteps: request.maxToolSteps }),
      });

      startEventStream(res);

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
          res.write(
            `data: ${JSON.stringify({
              error: capErrorText(getSafeErrorMessage(part.error, 'OpenRouter streaming error')),
            })}\n\n`
          );
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

      if (mcpCleanup) {
        mcpCleanup().catch((err: unknown) => console.warn('[MCP] Cleanup error:', err));
      }
    } catch (error) {
      if (mcpCleanup) {
        mcpCleanup().catch((err: unknown) => console.warn('[MCP] Cleanup error:', err));
      }

      // The browser left and the call stopped: not a proxy error, and no one to answer
      if (isAbortAfterClientLeft(error, res)) return;
      console.error('OpenRouter AI SDK Proxy error:', error);

      const errorMessage = getSafeErrorMessage(error, 'OpenRouter request failed');

      // The stream has started: report the error as an SSE event, so the chat shows it
      if (endStreamWithError(res, errorMessage)) return;

      sendJsonError(res, 500, errorMessage);
    }
  };
}
