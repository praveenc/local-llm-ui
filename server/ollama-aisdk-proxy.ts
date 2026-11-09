/**
 * Ollama AI SDK Proxy - Server-side streaming using ollama-ai-provider-v2
 *
 * Handles chat requests to Ollama using the AI SDK community provider.
 * Supports reasoning/thinking content extraction for models like Qwen3.
 * Supports an optional web search tool (Brave Search, Exa, or Tavily).
 */
import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import type { Connect } from 'vite';

import type { MCPServerConfig } from '../src/types/mcp.ts';
import { ollamaThinkValue } from '../src/utils/thinkingEffort.ts';
import type { OllamaThinkingInfo } from '../src/utils/thinkingEffort.ts';
import { getMCPTools } from './mcp-manager.ts';
import { capMaxTokens, readBodyWithLimit } from './security.ts';
import { noAnswerNotice, streamErrorMessage, toolLoopOptions } from './tool-loop.ts';
import {
  WEB_SEARCH_KEY_REQUIRED_ERROR,
  createWebSearchTool,
  getWebSearchProviders,
} from './web-search.ts';

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
  thinkingEffort?: unknown;
}

const OLLAMA_API = 'http://localhost:11434/api';

// Create Ollama provider instance
const ollama = createOllama({
  baseURL: OLLAMA_API,
});

/**
 * The model's thinking controls from Ollama /api/show. Models without the "thinking"
 * capability reject a `think` value, so `supported` is false for them and when the lookup fails.
 */
async function getOllamaThinking(
  model: string
): Promise<{ supported: boolean; thinking?: OllamaThinkingInfo }> {
  try {
    const response = await fetch(`${OLLAMA_API}/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) return { supported: false };
    const data = (await response.json()) as {
      capabilities?: string[];
      thinking?: OllamaThinkingInfo;
    };
    return { supported: data.capabilities?.includes('thinking') ?? false, thinking: data.thinking };
  } catch {
    return { supported: false };
  }
}

/**
 * A fetch that sets `think` in the Ollama request body. The AI SDK Ollama provider accepts only
 * true/false, but models such as gpt-oss take a level name ("low", "medium", "high").
 */
const fetchWithThink =
  (think: boolean | string): typeof fetch =>
  (input, init) => {
    if (typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      init = { ...init, body: JSON.stringify({ ...body, think }) };
    }
    return fetch(input, init);
  };

export function createOllamaAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/ollama-aisdk/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/ollama-aisdk/chat')) {
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

    let mcpCleanup: (() => Promise<void>) | undefined;
    try {
      const startTime = Date.now();

      // Set up SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Check if this might be a thinking model (qwen3, deepseek, etc.)
      const modelLower = request.model.toLowerCase();
      const isThinkingModel =
        modelLower.includes('qwen') || modelLower.includes('deepseek') || modelLower.includes('r1');

      // Web search API keys and the order to try the providers in
      const webSearchProviders = getWebSearchProviders(req.headers);
      if (request.enableWebSearch && webSearchProviders.length === 0) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: WEB_SEARCH_KEY_REQUIRED_ERROR }));
        return;
      }

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

      // Thinking effort chosen in the chat input. Without one ("Default"), keep the old rule:
      // turn thinking on for model names that suggest a thinking model.
      let think: boolean | string | undefined;
      if (request.thinkingEffort !== undefined && request.thinkingEffort !== 'default') {
        const info = await getOllamaThinking(request.model);
        if (info.supported) think = ollamaThinkValue(request.thinkingEffort, info.thinking);
      }
      const model =
        think === undefined
          ? ollama(request.model)
          : createOllama({ baseURL: OLLAMA_API, fetch: fetchWithThink(think) })(request.model);

      // Use AI SDK streamText with ollama provider
      const result = await streamText({
        model,
        // AI SDK 7 rejects system messages in `messages` by default; the local user owns the whole prompt
        allowSystemInMessages: true,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: capMaxTokens(request.max_tokens),
        topP: request.top_p ?? 0.9,
        tools,
        abortSignal: abortController.signal,
        // Tool loop that always ends with an answer (see tool-loop.ts)
        ...toolLoopOptions(tools),
        // Enable thinking for supported models
        ...(think === undefined &&
          isThinkingModel && {
            providerOptions: {
              ollama: { think: true },
            },
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Track content for <think> tag parsing (for models that use tags instead of separate field)
      let accumulatedContent = '';
      let inThinkBlock = false;
      let sentReasoning = '';
      let sentContent = '';

      // Stream the response - use fullStream to handle tool calls
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          const chunk = part.text;
          if (chunk) {
            accumulatedContent += chunk;

            // Process <think> tags for DeepSeek-style models
            if (!inThinkBlock && accumulatedContent.includes('<think>')) {
              const thinkStart = accumulatedContent.indexOf('<think>');
              // Send any content before <think>
              const beforeThink = accumulatedContent.substring(0, thinkStart);
              if (beforeThink.length > sentContent.length) {
                const newContent = beforeThink.substring(sentContent.length);
                if (newContent) {
                  res.write(`data: ${JSON.stringify({ content: newContent })}\n\n`);
                  sentContent = beforeThink;
                }
              }
              inThinkBlock = true;
            }

            if (inThinkBlock) {
              // Check if think block is closed
              if (accumulatedContent.includes('</think>')) {
                const thinkStartIdx = accumulatedContent.indexOf('<think>') + 7;
                const thinkEnd = accumulatedContent.indexOf('</think>');
                const reasoning = accumulatedContent.substring(thinkStartIdx, thinkEnd);

                // Send new reasoning content
                if (reasoning.length > sentReasoning.length) {
                  const newReasoning = reasoning.substring(sentReasoning.length);
                  if (newReasoning) {
                    res.write(`data: ${JSON.stringify({ reasoning: newReasoning })}\n\n`);
                    sentReasoning = reasoning;
                  }
                }

                inThinkBlock = false;

                // Reset for content after </think>
                const afterThink = accumulatedContent.substring(thinkEnd + 8);
                sentContent = '';
                accumulatedContent = afterThink;

                // Send any remaining content after </think>
                if (afterThink) {
                  res.write(`data: ${JSON.stringify({ content: afterThink })}\n\n`);
                  sentContent = afterThink;
                }
              } else {
                // Still in think block, extract and send reasoning incrementally
                const thinkStartIdx = accumulatedContent.indexOf('<think>') + 7;
                const reasoning = accumulatedContent.substring(thinkStartIdx);
                if (reasoning.length > sentReasoning.length) {
                  const newReasoning = reasoning.substring(sentReasoning.length);
                  if (newReasoning) {
                    res.write(`data: ${JSON.stringify({ reasoning: newReasoning })}\n\n`);
                    sentReasoning = reasoning;
                  }
                }
              }
            } else {
              // Not in think block, send content
              if (accumulatedContent.length > sentContent.length) {
                const newContent = accumulatedContent.substring(sentContent.length);
                if (newContent) {
                  res.write(`data: ${JSON.stringify({ content: newContent })}\n\n`);
                  sentContent = accumulatedContent;
                }
              }
            }
          }
        } else if (part.type === 'reasoning-delta') {
          // Thinking that Ollama returns in its own field (message.thinking)
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
          res.write(`data: ${JSON.stringify({ error: streamErrorMessage(part.error) })}\n\n`);
        }
      }

      // Explain a reply that ends with no answer text
      const notice = await noAnswerNotice(result);
      if (notice) res.write(`data: ${JSON.stringify({ content: notice })}\n\n`);

      // Get usage after the stream completes
      const usage = await result.usage;
      const latencyMs = Date.now() - startTime;

      // Send metadata with usage
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
      console.error('Ollama AI SDK Proxy error:', error);

      // If headers already sent, we can't change status code
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check for connection errors
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        res.end(
          JSON.stringify({
            error: 'Cannot connect to Ollama. Please ensure Ollama is running on port 11434.',
          })
        );
      } else {
        res.end(JSON.stringify({ error: errorMessage }));
      }
    }
  };
}
