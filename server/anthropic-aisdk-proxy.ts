/**
 * Anthropic AI SDK Proxy - Server-side streaming for Anthropic Claude models
 *
 * Handles chat requests using Vercel AI SDK with SSE streaming format.
 * API key passed from client via header (stored in localStorage).
 * Supports Tavily web search tool integration and extended thinking.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { tavilySearch } from '@tavily/ai-sdk';
import { stepCountIs, streamText } from 'ai';
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
  enableThinking?: boolean;
  thinkingBudget?: number;
}

// Models that support extended thinking
const THINKING_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-sonnet-4',
];

export function createAnthropicProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/anthropic/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/anthropic/chat')) {
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

    // Get API key from header
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Anthropic API key required' }));
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

    try {
      const anthropic = createAnthropic({ apiKey });
      const startTime = Date.now();

      // Set up SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

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

      // Check if model supports thinking (all 4.5 models support it)
      const supportsThinking = THINKING_MODELS.some((m) => request.model.includes(m));
      const enableThinking = request.enableThinking && supportsThinking;

      // Build provider options for thinking
      const providerOptions = enableThinking
        ? {
            anthropic: {
              thinking: {
                type: 'enabled' as const,
                budgetTokens: request.thinkingBudget || 10000,
              },
            },
          }
        : undefined;

      const result = await streamText({
        model: anthropic(request.model),
        messages: request.messages,
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        topP: request.top_p,
        tools,
        abortSignal: abortController.signal,
        providerOptions,
        // stopWhen required for multi-step tool use (agentic behavior)
        ...(tools && { stopWhen: stepCountIs(5) }),
      });

      // Stream text chunks and handle tool calls
      for await (const part of result.fullStream) {
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
    } catch (error) {
      console.error('Anthropic Proxy error:', error);

      // If headers already sent, we can't change status code
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.end(JSON.stringify({ error: errorMessage }));
    }
  };
}
