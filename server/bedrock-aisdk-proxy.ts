/**
 * Bedrock AI SDK Proxy
 *
 * Server-side proxy using @ai-sdk/amazon-bedrock for streaming chat.
 * Returns responses in AI SDK UIMessage stream format.
 * Supports optional Tavily web search tool integration.
 */
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { tavilySearch } from '@tavily/ai-sdk';
import { stepCountIs, streamText } from 'ai';
import type { ToolSet } from 'ai';
import type { IncomingMessage, ServerResponse } from 'http';

import type { MCPServerConfig } from '../src/types/mcp';
import { getMCPServerStatus, getMCPTools } from './mcp-manager';
import { capMaxTokens, readBodyWithLimit, setCORSHeaders } from './security';

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
  }: ChatRequest = JSON.parse(body);

  // Get Tavily API key from header if web search is enabled
  const tavilyApiKey = req.headers['x-tavily-api-key'] as string;

  if (enableWebSearch && !tavilyApiKey) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Tavily API key required for web search' }));
    return;
  }

  // Claude 4.x models don't support both temperature and topP simultaneously
  const isClaude4x = /claude[.-](?:sonnet|haiku|opus)-4(?:[.-]|$)/i.test(model);

  if (isClaude4x) {
    // For Claude 4.x, only use one sampling parameter (handled below)
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
  if (enableWebSearch && tavilyApiKey) {
    allTools.webSearch = tavilySearch({ apiKey: tavilyApiKey });
  }
  const tools = Object.keys(allTools).length > 0 ? allTools : undefined;

  // Create abort controller to cancel streamText when client disconnects
  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  try {
    const result = streamText({
      model: bedrock(model),
      messages: transformedMessages,
      maxOutputTokens: capMaxTokens(max_tokens),
      tools,
      abortSignal: abortController.signal,
      // stopWhen required for multi-step tool use (agentic behavior)
      ...(tools && { stopWhen: stepCountIs(5) }),
      // Handle Claude 4.x temperature/topP constraints
      ...(isClaude4x
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

    // Stream text chunks and handle tool calls
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        res.write(`data: ${JSON.stringify({ content: part.text })}\n\n`);
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
