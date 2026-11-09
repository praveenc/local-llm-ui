/**
 * Bedrock AI SDK Proxy
 *
 * Server-side proxy using @ai-sdk/amazon-bedrock for streaming chat.
 * Returns responses in AI SDK UIMessage stream format.
 * Supports an optional web search tool (Brave Search, Exa, or Tavily).
 */
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { getModelCapabilities } from '@ai-sdk/anthropic/internal';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { isStepCount, streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { IncomingMessage, ServerResponse } from 'http';

import type { MCPServerConfig } from '../src/types/mcp.ts';
import { buildSamplingParams } from '../src/utils/samplingParams.ts';
import { buildReasoningParams, fallbackReasoningLevel } from '../src/utils/thinkingEffort.ts';
import type { ReasoningLevel } from '../src/utils/thinkingEffort.ts';
import { getMCPServerStatus, getMCPTools } from './mcp-manager.ts';
import { capMaxTokens, readBodyWithLimit, setCORSHeaders } from './security.ts';
import {
  WEB_SEARCH_KEY_REQUIRED_ERROR,
  createWebSearchTool,
  getWebSearchProviders,
} from './web-search.ts';

// Initialize Bedrock provider with credential chain
const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION || process.env.VITE_AWS_REGION || 'us-west-2',
  credentialProvider: fromNodeProviderChain(),
});

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  files?: Array<{
    name: string;
    format: string;
    bytes: string; // base64 encoded
  }>;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  enableWebSearch?: boolean;
  mcpServers?: MCPServerConfig[];
  thinkingEffort?: unknown;
}

/** Share of the model's max output tokens that each effort uses as a thinking budget */
const THINKING_BUDGET_SHARE: Record<Exclude<ReasoningLevel, 'none'>, number> = {
  minimal: 0.02,
  low: 0.1,
  medium: 0.3,
  high: 0.6,
  xhigh: 0.9,
};

/**
 * Thinking settings for a Claude model on Bedrock.
 *
 * - `display: 'summarized'` makes Claude 4.7+ and 5.x return the thinking text. They omit it
 *   by default.
 * - Claude 4.0 - 4.5 take a thinking token budget. The AI SDK adds the budget to max_tokens, and
 *   on Bedrock it does not cap the sum at the model limit, so Bedrock rejects the request. We
 *   set the budget here and lower max_tokens so that the sum fits.
 */
function claudeThinkingConfig(
  model: string,
  reasoning: ReasoningLevel | undefined,
  maxTokens: number
): {
  maxTokens: number;
  reasoningConfig?: { display: 'summarized'; type?: 'enabled'; budgetTokens?: number };
} {
  if (!reasoning || reasoning === 'none' || !/claude/i.test(model)) return { maxTokens };
  const capabilities = getModelCapabilities(model);
  if (capabilities.supportsAdaptiveThinking || capabilities.rejectsBudgetThinking) {
    return { maxTokens, reasoningConfig: { display: 'summarized' } };
  }
  const modelMax = capabilities.maxOutputTokens;
  const budgetTokens = Math.min(
    modelMax - 1024,
    Math.max(1024, Math.round(modelMax * THINKING_BUDGET_SHARE[reasoning]))
  );
  return {
    maxTokens: Math.min(maxTokens, modelMax - budgetTokens),
    reasoningConfig: { display: 'summarized', type: 'enabled', budgetTokens },
  };
}

/** Error message plus the response body, which holds Bedrock's own message */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const body = (error as { responseBody?: unknown }).responseBody;
  return typeof body === 'string' ? `${error.message} ${body}` : error.message;
}

export async function handleBedrockAISDKRequest(
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
    if (pathname === '/api/bedrock-aisdk/chat') {
      await handleChat(req, res);
    } else if (pathname === '/api/bedrock-aisdk/mcp-status') {
      await handleMCPStatus(req, res);
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('Bedrock AI SDK proxy error:', error);
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
    } else if ('statusCode' in err && (err as { statusCode?: number }).statusCode === 400) {
      // Surface Bedrock validation errors (e.g. unsupported MIME type) with the actual message
      const apiErr = err as {
        statusCode: number;
        data?: { message?: string };
        responseBody?: string;
      };
      const bedrockMessage =
        apiErr.data?.message ||
        (apiErr.responseBody
          ? (() => {
              try {
                return JSON.parse(apiErr.responseBody!).message;
              } catch {
                return undefined;
              }
            })()
          : undefined);
      if (bedrockMessage) {
        errorMessage = bedrockMessage;
      }
      statusCode = 400;
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

/**
 * Handle MCP server status check — returns per-server connectivity and tool list.
 */
async function handleMCPStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const body = await readBodyWithLimit(req, res);
  if (body === null) return; // 413 already sent

  const { mcpServers } = JSON.parse(body || '{}') as {
    mcpServers?: MCPServerConfig[];
  };

  const servers = await getMCPServerStatus(mcpServers ?? []);

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ servers }));
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBodyWithLimit(req, res);
  if (body === null) return; // 413 already sent

  const {
    model,
    messages,
    temperature,
    max_tokens,
    top_p,
    enableWebSearch,
    mcpServers,
    thinkingEffort,
  }: ChatRequest = JSON.parse(body);

  // Web search API keys and the order to try the providers in
  const webSearchProviders = getWebSearchProviders(req.headers);

  if (enableWebSearch && webSearchProviders.length === 0) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: WEB_SEARCH_KEY_REQUIRED_ERROR }));
    return;
  }

  // Send only the sampling parameters this model accepts
  const samplingParams = buildSamplingParams(model, {
    temperature: temperature ?? 0.3,
    topP: top_p ?? 0.95,
    preferred: temperature === undefined && top_p !== undefined ? 'topP' : 'temperature',
  });

  // Send the thinking effort only for models that accept it
  const reasoningParams = buildReasoningParams('bedrock', model, thinkingEffort);

  // Transform messages to AI SDK format with file support
  const transformedMessages = messages.map((msg) => {
    // If message has files, convert to multipart content (user messages only)
    if (msg.role === 'user' && msg.files && msg.files.length > 0) {
      const content: Array<
        { type: 'text'; text: string } | { type: 'file'; data: Uint8Array; mediaType: string }
      > = [];

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add file parts
      for (const file of msg.files) {
        const mediaType = getMediaType(file.format);
        content.push({
          type: 'file',
          data: new Uint8Array(Buffer.from(file.bytes, 'base64')),
          mediaType,
        });
      }

      return {
        role: 'user' as const,
        content,
      };
    }

    // Simple text message
    if (msg.role === 'system') {
      return { role: 'system' as const, content: msg.content };
    } else if (msg.role === 'assistant') {
      return { role: 'assistant' as const, content: msg.content };
    }
    return { role: 'user' as const, content: msg.content };
  });

  // Get MCP tools if configured
  let mcpTools: Record<string, unknown> = {};
  let mcpCleanup: (() => Promise<void>) | undefined;
  if (mcpServers && mcpServers.length > 0) {
    const mcp = await getMCPTools(mcpServers);
    mcpTools = mcp.tools;
    mcpCleanup = mcp.cleanup;
  }

  // Configure tools - merge web search and MCP tools
  const allTools: ToolSet = { ...mcpTools } as ToolSet;
  if (enableWebSearch && webSearchProviders.length > 0) {
    allTools.webSearch = createWebSearchTool(webSearchProviders);
  }
  const tools = Object.keys(allTools).length > 0 ? allTools : undefined;

  // Create abort controller to cancel streamText when client disconnects
  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  try {
    // Request options for a thinking effort (undefined: send none)
    const thinkingOptions = (reasoning: ReasoningLevel | undefined) => {
      const thinking = claudeThinkingConfig(model, reasoning, capMaxTokens(max_tokens));
      // Reasoning models reject temperature and top_p while they think (Nova 2 at high effort
      // returns a ValidationException), so leave them out when thinking is on
      const isThinking = reasoning !== undefined && reasoning !== 'none';
      return {
        maxOutputTokens: thinking.maxTokens,
        ...(isThinking ? {} : samplingParams),
        ...(reasoning && { reasoning }),
        ...(thinking.reasoningConfig && {
          providerOptions: { amazonBedrock: { reasoningConfig: thinking.reasoningConfig } },
        }),
      };
    };
    const startStream = (reasoning: ReasoningLevel | undefined) =>
      streamText({
        model: bedrock(model),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages: transformedMessages,
        tools,
        abortSignal: abortController.signal,
        // stopWhen required for multi-step tool use (agentic behavior)
        ...(tools && { stopWhen: isStepCount(5) }),
        ...thinkingOptions(reasoning),
      });

    // Use SSE format to stream text and then send usage metadata
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const startTime = Date.now();

    let reasoning = reasoningParams.reasoning;
    let result = startStream(reasoning);
    let canRetry = reasoning !== undefined;

    // Stream text chunks and handle tool calls
    for (;;) {
      let retryWith: ReasoningLevel | null = null;
      for await (const part of result.stream) {
        if (part.type === 'error' && canRetry && reasoning) {
          // Some models reject some efforts (OpenAI models on Bedrock reject 'minimal'). Retry
          // once with the nearest effort from the error's list of accepted values.
          retryWith = fallbackReasoningLevel(reasoning, errorText(part.error));
          if (retryWith) break;
        } else if (part.type === 'text-delta') {
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
        }
        // Only an error before any output can be retried
        if (part.type !== 'error' && part.type !== 'start' && part.type !== 'start-step') {
          canRetry = false;
        }
      }
      if (!retryWith) break;
      console.warn(
        `Bedrock: ${model} rejected effort '${reasoning}'. Retrying with '${retryWith}'.`
      );
      reasoning = retryWith;
      canRetry = false;
      result = startStream(reasoning);
    }

    // Get usage after stream completes
    const usage = await result.usage;
    const latencyMs = Date.now() - startTime;

    // Send usage metadata
    if (usage) {
      res.write(
        `data: ${JSON.stringify({
          metadata: {
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            },
            latencyMs,
          },
        })}\n\n`
      );
    }

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
    console.error('Bedrock AI SDK: Stream error:', error);
    throw error;
  }
}

/**
 * Map file format to media type for AI SDK
 */
function getMediaType(format: string): string {
  const formatMap: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    html: 'text/html',
    md: 'text/markdown',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };

  const mimeType = formatMap[format.toLowerCase()];
  if (!mimeType) {
    throw new Error(
      `Unsupported file format "${format}". Supported: pdf, txt, html, md, csv, doc, docx, xls, xlsx, and images.`
    );
  }
  return mimeType;
}
