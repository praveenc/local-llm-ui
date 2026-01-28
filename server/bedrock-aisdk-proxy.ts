/**
 * Bedrock AI SDK Proxy
 *
 * Server-side proxy using @ai-sdk/amazon-bedrock for streaming chat.
 * Returns responses in AI SDK UIMessage stream format.
 */
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { streamText } from 'ai';
import type { IncomingMessage, ServerResponse } from 'http';

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
}

export async function handleBedrockAISDKRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    if (pathname === '/api/bedrock-aisdk/chat') {
      await handleChat(req, res);
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

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { model, messages, temperature, max_tokens, top_p }: ChatRequest = JSON.parse(body);

  // Claude 4.5 models don't support both temperature and topP simultaneously
  const isClaude45 =
    model.includes('sonnet-4-5') || model.includes('haiku-4-5') || model.includes('opus-4-5');

  if (isClaude45) {
    // For Claude 4.5, only use one sampling parameter (handled below)
  }

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

  try {
    const result = streamText({
      model: bedrock(model),
      messages: transformedMessages,
      maxOutputTokens: max_tokens ?? 2048,
      // Handle Claude 4.5 temperature/topP constraints
      ...(isClaude45
        ? temperature !== undefined
          ? { temperature }
          : top_p !== undefined
            ? { topP: top_p }
            : { temperature: 0.3 }
        : {
            temperature: temperature ?? 0.3,
            topP: top_p ?? 0.95,
          }),
    });

    // Use SSE format to stream text and then send usage metadata
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const startTime = Date.now();

    // Stream text chunks
    for await (const chunk of result.textStream) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
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
  } catch (error) {
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

  return formatMap[format.toLowerCase()] || 'application/octet-stream';
}
