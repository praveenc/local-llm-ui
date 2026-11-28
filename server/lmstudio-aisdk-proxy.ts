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
import { createThinkTagSplitter } from './think-tags.ts';
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

const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';

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

    // Size limit, JSON, and the fields of every chat request (SEC-07, SEC-22)
    const request = await readChatRequest(req, res);
    if (!request) return; // 413 or 400 already sent

    // The files as this provider's parts (D-A c); a type that it cannot take is a 400
    const messages = modelMessagesOr400(res, request.messages, 'lmstudio');
    if (!messages) return; // 400 already sent

    // Web search API keys and the order to try the providers in
    const webSearchProviders = getWebSearchProviders(req.headers);
    if (request.enableWebSearch && webSearchProviders.length === 0) {
      sendJsonError(res, 401, WEB_SEARCH_KEY_REQUIRED_ERROR);
      return;
    }

    let mcpCleanup: (() => Promise<void>) | undefined;
    try {
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

      const result = streamText({
        model: lmstudio(request.model),
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        tools,
        abortSignal,
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

      // Set up SSE response
      startEventStream(res);

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
          res.write(`data: ${JSON.stringify({ error: lmstudioErrorMessage(part.error) })}\n\n`);
        }
      }
      writeParts(splitter.flush());

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
      console.error('LMStudio AI SDK Proxy error:', error);
      const errorMessage = lmstudioErrorMessage(error);

      // The stream has started: report the error as an SSE event, so the chat shows it
      if (endStreamWithError(res, errorMessage)) return;

      sendJsonError(res, 500, errorMessage);
    }
  };
}
