/**
 * LM Studio AI SDK Proxy - Server-side streaming using @ai-sdk/openai-compatible
 *
 * Handles chat requests to LM Studio using the OpenAI-compatible API.
 * Supports reasoning/thinking content extraction for models like DeepSeek-R1.
 */
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
}

export function createLMStudioAISDKProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // Only handle POST requests to /api/lmstudio-aisdk/chat
    if (req.method !== 'POST' || !req.url?.startsWith('/api/lmstudio-aisdk/chat')) {
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

      // Create abort controller to cancel fetch when client disconnects
      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      const directResponse = await fetch('http://localhost:1234/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.max_tokens ?? 2048,
          top_p: request.top_p ?? 0.9,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abortController.signal,
      });

      if (!directResponse.ok) {
        throw new Error(`LM Studio error: ${directResponse.status}`);
      }

      const reader = directResponse.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const decoder = new TextDecoder();
      let buffer = '';
      let usageData: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | null = null;

      // Track content for <think> tag parsing
      let accumulatedContent = '';
      let inThinkBlock = false;
      let sentReasoning = '';
      let sentContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              const delta = parsed.choices?.[0]?.delta;

              // Check for reasoning content - different models use different field names:
              // - MiniMax uses delta.reasoning
              // - NemoTron uses delta.reasoning_content
              const reasoningContent = delta?.reasoning || delta?.reasoning_content;
              if (reasoningContent) {
                res.write(`data: ${JSON.stringify({ reasoning: reasoningContent })}\n\n`);
              }

              // Check for content and handle <think> tags
              if (delta?.content) {
                accumulatedContent += delta.content;

                // Process <think> tags
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
                    const thinkStart = accumulatedContent.indexOf('<think>') + 7;
                    const thinkEnd = accumulatedContent.indexOf('</think>');
                    const reasoning = accumulatedContent.substring(thinkStart, thinkEnd);

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
                  } else {
                    // Still in think block, extract and send reasoning incrementally
                    const thinkStart = accumulatedContent.indexOf('<think>') + 7;
                    const reasoning = accumulatedContent.substring(thinkStart);
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

              // Check for usage in the chunk (LM Studio sends this at the end with stream_options)
              if (parsed.usage) {
                usageData = parsed.usage;
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      const latencyMs = Date.now() - startTime;

      // Send metadata with usage
      res.write(
        `data: ${JSON.stringify({
          metadata: {
            usage: {
              inputTokens: usageData?.prompt_tokens || 0,
              outputTokens: usageData?.completion_tokens || 0,
              totalTokens: usageData?.total_tokens || 0,
            },
            latencyMs,
          },
        })}\n\n`
      );

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error('LMStudio AI SDK Proxy error:', error);

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
            error:
              'Cannot connect to LM Studio. Please ensure LM Studio is running with the server enabled on port 1234.',
          })
        );
      } else {
        res.end(JSON.stringify({ error: errorMessage }));
      }
    }
  };
}
