/**
 * Anthropic AI SDK Proxy - Server-side streaming for Anthropic Claude models
 *
 * Handles chat requests using Vercel AI SDK with SSE streaming format.
 * API key passed from client via header (stored in localStorage).
 * Supports a web search tool (Brave Search, Exa, or Tavily) and thinking effort.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { Connect } from 'vite';

import { buildReasoningParams } from '../src/utils/thinkingEffort.ts';
import { getMCPTools } from './mcp-manager.ts';
import { modelMessagesOr400 } from './model-messages.ts';
import {
  abortOnClose,
  capMaxTokens,
  endStreamWithError,
  isAbortAfterClientLeft,
  readChatRequest,
  sendJsonError,
  startEventStream,
} from './security.ts';
import {
  noAnswerNotice,
  streamErrorMessage,
  toolErrorEvent,
  toolLoopOptions,
} from './tool-loop.ts';
import { usageEvent } from './usage.ts';
import {
  WEB_SEARCH_KEY_REQUIRED_ERROR,
  createWebSearchTool,
  getWebSearchProviders,
} from './web-search.ts';

export function createAnthropicProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/anthropic/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/anthropic/chat')) {
      return next();
    }

    // Size limit, JSON, and the fields of every chat request (SEC-07, SEC-22)
    const request = await readChatRequest(req, res);
    if (!request) return; // 413 or 400 already sent

    // The files as this provider's parts (D-A c); a type that it cannot take is a 400
    const messages = modelMessagesOr400(res, request.messages, 'anthropic');
    if (!messages) return; // 400 already sent

    // Get API key from header
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      sendJsonError(res, 401, 'Anthropic API key required');
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
      const anthropic = createAnthropic({ apiKey });
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

      // Send the thinking effort only for models that accept it. The AI SDK maps it to adaptive
      // thinking (and asks for the thinking text) or to a thinking token budget.
      const reasoningParams = buildReasoningParams(
        'anthropic',
        request.model,
        request.thinkingEffort
      );

      const result = await streamText({
        model: anthropic(request.model),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal,
        ...reasoningParams,
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
          // Handle reasoning/thinking content from Anthropic
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
          res.write(`data: ${JSON.stringify({ error: streamErrorMessage(part.error) })}\n\n`);
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
      console.error('Anthropic Proxy error:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // The stream has started: report the error as an SSE event, so the chat shows it
      if (endStreamWithError(res, errorMessage)) return;

      sendJsonError(res, 500, errorMessage);
    }
  };
}
