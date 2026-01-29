/**
 * Ollama AI SDK Proxy - Server-side streaming using ollama-ai-provider-v2
 *
 * Handles chat requests to Ollama using the AI SDK community provider.
 * Supports reasoning/thinking content extraction for models like Qwen3.
 * Supports optional Tavily web search tool integration.
 */
import { tavilySearch } from '@tavily/ai-sdk';
import { stepCountIs, streamText } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import type { Connect } from 'vite';

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
}

// Create Ollama provider instance
const ollama = createOllama({
  baseURL: 'http://localhost:11434/api',
});

export function createOllamaAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/ollama-aisdk/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/ollama-aisdk/chat')) {
      return next();
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let request: ChatRequest;
    try {
      request = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

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

      // Get Tavily API key from header if web search is enabled
      const tavilyApiKey = req.headers['x-tavily-api-key'] as string;
      if (request.enableWebSearch && !tavilyApiKey) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Tavily API key required for web search' }));
        return;
      }

      // Configure tools if web search is enabled
      const tools =
        request.enableWebSearch && tavilyApiKey
          ? { webSearch: tavilySearch({ apiKey: tavilyApiKey }) }
          : undefined;

      // Create abort controller to cancel streamText when client disconnects
      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      // Use AI SDK streamText with ollama provider
      const result = await streamText({
        model: ollama(request.model),
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.max_tokens ?? 2048,
        topP: request.top_p ?? 0.9,
        tools,
        abortSignal: abortController.signal,
        // stopWhen required for multi-step tool use (agentic behavior)
        ...(tools && { stopWhen: stepCountIs(5) }),
        // Enable thinking for supported models
        ...(isThinkingModel && {
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
      for await (const part of result.fullStream) {
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
      }

      // Get usage data after stream completes
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
    } catch (error) {
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
