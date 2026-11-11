/**
 * LM Studio AI SDK Proxy - Server-side streaming using @ai-sdk/openai-compatible
 *
 * Handles chat requests to LM Studio's OpenAI-compatible server through the AI SDK, so LM
 * Studio gets the same tool loop, web search, and MCP tools as the other providers.
 * Reasoning: the provider reports `reasoning_content` (and `reasoning`) deltas as reasoning
 * parts. Models that write <think> tags inline are split by think-tags.ts.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { Connect } from 'vite';

import type { MCPServerConfig } from '../src/types/mcp.ts';
import { getMCPTools } from './mcp-manager.ts';
import { capMaxTokens, endStreamWithError, readBodyWithLimit } from './security.ts';
import { createThinkTagSplitter } from './think-tags.ts';
import { noAnswerNotice, streamErrorMessage, toolLoopOptions } from './tool-loop.ts';
import {
  WEB_SEARCH_KEY_REQUIRED_ERROR,
  createWebSearchTool,
  getWebSearchProviders,
} from './web-search.ts';

const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  enableWebSearch?: boolean;
  mcpServers?: MCPServerConfig[];
  /** Most model calls in one reply when tools are on */
  maxToolSteps?: unknown;
}

// LM Studio needs no API key; the provider requires one, so send a placeholder
const lmstudio = createOpenAICompatible({
  name: 'lmstudio',
  baseURL: LMSTUDIO_BASE_URL,
  apiKey: 'lm-studio',
  includeUsage: true,
});

const NOT_CONNECTED =
  'Cannot connect to LM Studio. Please ensure LM Studio is running with the server enabled on port 1234.';

/** A short message for an error; a refused connection gets the LM Studio hint */
function lmstudioErrorMessage(error: unknown): string {
  const message = streamErrorMessage(error);
  return message.includes('ECONNREFUSED') || message.includes('fetch failed')
    ? NOT_CONNECTED
    : message;
}

export function createLMStudioAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/lmstudio-aisdk/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/lmstudio-aisdk/chat')) {
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

      const result = streamText({
        model: lmstudio(request.model),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages: request.messages,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal: abortController.signal,
        // Tool loop that always ends with an answer (see tool-loop.ts)
        ...toolLoopOptions(tools, { maxSteps: request.maxToolSteps }),
      });

      // Models without a reasoning field write <think> tags in the text
      const splitter = createThinkTagSplitter();
      const writeParts = (parts: Array<{ type: 'reasoning' | 'content'; text: string }>) => {
        for (const out of parts) {
          res.write(`data: ${JSON.stringify({ [out.type]: out.text })}\n\n`);
        }
      };

      // Stream text chunks and handle tool calls
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          writeParts(splitter.push(part.text));
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
          res.write(`data: ${JSON.stringify({ error: lmstudioErrorMessage(part.error) })}\n\n`);
        }
      }
      writeParts(splitter.flush());

      // Explain a reply that ends with no answer text
      const notice = await noAnswerNotice(result);
      if (notice) res.write(`data: ${JSON.stringify({ content: notice })}\n\n`);

      // Get usage after the stream completes
      const usage = await Promise.resolve(result.usage).catch(() => undefined);
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
      console.error('LMStudio AI SDK Proxy error:', error);
      const errorMessage = lmstudioErrorMessage(error);

      // The stream has started: report the error as an SSE event, so the chat shows it
      if (endStreamWithError(res, errorMessage)) return;

      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: errorMessage }));
    }
  };
}
