# AI SDK Learnings

This document captures learnings and best practices discovered while implementing AI SDK integrations across different providers.

## General AI SDK Patterns

### Streaming Architecture

All providers use a consistent SSE (Server-Sent Events) format:
```
data: {"content": "text chunk"}\n\n
data: {"reasoning": "thinking chunk"}\n\n
data: {"metadata": {"usage": {...}, "latencyMs": 123}}\n\n
data: [DONE]\n\n
```

### Key Parameters

- Use `maxOutputTokens` (not `maxTokens`) for AI SDK
- Claude 4.x models (4, 4.5, 4.6+) don't support both `temperature` and `top_p` simultaneously
- Always filter empty messages before sending to API

### Usage Metrics

- AI SDK usage properties: `inputTokens`, `outputTokens`, `totalTokens`
- OpenAI-compatible APIs: `prompt_tokens`, `completion_tokens`, `total_tokens`
- For streaming, add `stream_options: { include_usage: true }` to get usage data

### Architecture Decision: Server-Side Proxies

All chat functionality routes through server-side proxies in `server/` directory. Client services (`src/services/`) only handle:
- `getModels()` - Fetch available models
- `checkConnection()` - Verify provider connectivity

This architecture:
- Keeps API keys server-side (AWS credentials, etc.)
- Provides consistent SSE streaming format across all providers
- Simplifies client code (single `useBedrockChat` hook handles all providers)
- Reduces bundle size (~164KB saved by removing client-side chat methods)

---

## Provider-Specific Learnings

### LM Studio (@ai-sdk/openai-compatible)

**Date**: 2026-01-13

**Package**: `@ai-sdk/openai-compatible`

**Setup**:
```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const lmstudio = createOpenAICompatible({
  name: 'lmstudio',
  baseURL: 'http://localhost:1234/v1',
});
```

**Reasoning Content Formats**:
Different models use different field names for reasoning/thinking:
- MiniMax: `delta.reasoning`
- NemoTron: `delta.reasoning_content`
- DeepSeek-style: `<think>...</think>` tags in `delta.content`

**Implementation Notes**:
1. Direct fetch to LM Studio API works better than AI SDK's streamText for raw chunk inspection
2. Parse SSE chunks manually to extract reasoning from various formats
3. Track `<think>` block state for DeepSeek-style models
4. Usage data comes in final chunk when `stream_options.include_usage: true`

**Files**:
- `server/lmstudio-aisdk-proxy.ts` - Server-side proxy

---

### Ollama (ollama-ai-provider-v2)

**Date**: 2026-01-27

**Package**: `ollama-ai-provider-v2` (community provider)

**Setup**:
```typescript
import { createOllama } from 'ollama-ai-provider-v2';

const ollama = createOllama({
  baseURL: 'http://localhost:11434/api',
});
```

**Key Differences from OpenAI-compatible**:
- Uses AI SDK's `streamText()` directly (unlike LM Studio which uses direct fetch)
- Supports hybrid reasoning via `providerOptions.ollama.think: true` for models like Qwen3
- Usage comes from `result.usage` after stream completes

**Reasoning Support**:
- Qwen3 and similar models support `think: true` provider option
- Also handles `<think>...</think>` tags in content for DeepSeek-style models

**Implementation Notes**:
1. Use AI SDK's `streamText()` with the ollama provider
2. Enable thinking for supported models: `providerOptions: { ollama: { think: true } }`
3. Parse `<think>` tags for models that embed reasoning in content
4. Usage available via `await result.usage` after stream completes

**Files**:
- `server/ollama-aisdk-proxy.ts` - Server-side proxy

---

### Bedrock (@ai-sdk/amazon-bedrock)

**Date**: 2026-01-13

**Package**: `@ai-sdk/amazon-bedrock`

**Setup**:
```typescript
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION || 'us-west-2',
  credentialProvider: fromNodeProviderChain(),
});
```

**Implementation Notes**:
1. Credentials via AWS SDK credential provider chain
2. Claude 4.x models require either `temperature` OR `topP`, not both (applies to all Claude 4.x family: 4, 4.5, 4.6, etc.)
3. File attachments converted to `{ type: 'file', data: Uint8Array, mediaType }` format

**Files**:
- `server/bedrock-aisdk-proxy.ts` - Server-side proxy

---

### Groq & Cerebras (@ai-sdk/groq, @ai-sdk/cerebras)

**Date**: 2026-01-13

**Packages**: `@ai-sdk/groq`, `@ai-sdk/cerebras`

**Setup**:
```typescript
import { createGroq } from '@ai-sdk/groq';
import { createCerebras } from '@ai-sdk/cerebras';

const groq = createGroq({ apiKey });
const cerebras = createCerebras({ apiKey });
```

**Implementation Notes**:
1. API keys passed via `X-Api-Key` header from client
2. Both use standard AI SDK `streamText()` pattern
3. Usage available via `await result.usage` after stream

**Files**:
- `server/aisdk-proxy.ts` - Shared proxy for both providers

---

### Bedrock Mantle (OpenAI-compatible)

**Date**: 2026-01-13

**Package**: Direct fetch (OpenAI-compatible API)

**Setup**:
```typescript
const baseUrl = `https://bedrock-mantle.${region}.api.aws/v1`;
// Uses Bearer token auth
```

**Reasoning Support**:
- MiniMax models return `delta.reasoning` for thinking content
- Request `stream_options: { include_usage: true }` for usage in streaming

**Implementation Notes**:
1. OpenAI-compatible API format
2. Supports multiple regions (us-east-1, us-west-2, eu-west-1, etc.)
3. Model names formatted for display (e.g., `nvidia.nemotron-nano-9b-v2` → `NVIDIA Nemotron Nano 9B v2`)

**Files**:
- `server/mantle-proxy.ts` - Server-side proxy

---

### Anthropic (@ai-sdk/anthropic)

**Date**: 2026-01-29

**Package**: `@ai-sdk/anthropic`

**Setup**:
```typescript
import { createAnthropic } from '@ai-sdk/anthropic';

const anthropic = createAnthropic({ apiKey });
```

**Extended Thinking Support**:
Claude 4.5 models support extended thinking via `providerOptions`:

```typescript
const result = streamText({
  model: anthropic(modelId),
  messages,
  providerOptions: {
    anthropic: {
      thinking: { type: 'enabled', budgetTokens: 12000 },
    },
  },
});
```

**Reasoning Stream Part**:
When thinking is enabled, reasoning content comes via `reasoning-delta` part type:

```typescript
for await (const part of result.fullStream) {
  if (part.type === 'reasoning-delta') {
    // part.text contains thinking content
  }
}
```

**Implementation Notes**:
1. API key passed via `X-Api-Key` header from client
2. Uses standard AI SDK `streamText()` pattern
3. Supports Tavily web search tool integration
4. Supports abort signal for stop generation
5. Models that support thinking: All Claude 4.5 models

**Available Models (Claude 4.5 Series)**:
- `claude-opus-4-5-20251101` - Claude Opus 4.5 ($5/$25 per MTok)
- `claude-sonnet-4-5-20250929` - Claude Sonnet 4.5 ($3/$15 per MTok)
- `claude-haiku-4-5-20251001` - Claude Haiku 4.5 ($1/$5 per MTok)
- `claude-sonnet-4-20250514` - Claude Sonnet 4 Legacy ($3/$15 per MTok)

**Custom Pricing Implementation**:
The `tokenlens` library doesn't recognize Claude 4.5 model IDs, so custom pricing was implemented:
- `src/utils/anthropicPricing.ts` - Pricing calculation for Anthropic models
- `src/components/ai-elements/context.tsx` - Uses `isAnthropicModel()` to route to custom pricing

**Cost Display Fix**:
Small token costs (fractions of a cent) were displaying as `$0.00` due to currency formatting rounding. Fixed by using adaptive precision:
- < $0.01: Show 4 decimal places (`$0.0001`)
- < $1.00: Show 3 decimal places (`$0.123`)
- >= $1.00: Standard currency format (`$1.23`)

**Files**:
- `server/anthropic-aisdk-proxy.ts` - Server-side proxy
- `src/services/aisdk.ts` - Client service (getModels, checkConnection)
- `src/utils/anthropicPricing.ts` - Custom pricing calculation

---

## Common Pitfalls

### 1. Stream Format Confusion

- AI SDK's `toTextStreamResponse()` returns plain text
- AI SDK's `toDataStreamResponse()` returns prefixed format (`0:`, `d:`, `e:`)
- Custom SSE format is most flexible for metadata

### 2. Async Iteration

- `streamText()` returns a promise-like object that must be awaited
- Use `for await (const chunk of result.textStream)` pattern

### 3. Context Loss with Portals

- Radix UI's DropdownMenu uses Portal by default
- Use `modal={false}` or avoid Portal for programmatic interactions

### 4. Z-Index Stacking

- Prompt input: `z-[1000]`
- Popovers/dialogs: `z-[1100]`
- Ensure consistent stacking across components

### 5. Dead Code Accumulation

- When migrating to server-side proxies, client-side `chat()` methods become dead code
- Regularly audit and remove unused code to reduce bundle size
- In this project, removing dead chat methods saved ~164KB

---

## Provider Comparison

| Feature | Bedrock | Mantle | Groq | Cerebras | LM Studio | Ollama | Anthropic |
|---------|---------|--------|------|----------|-----------|--------|-----------|
| Package | @ai-sdk/amazon-bedrock | fetch (OpenAI) | @ai-sdk/groq | @ai-sdk/cerebras | @ai-sdk/openai-compatible | ollama-ai-provider-v2 | @ai-sdk/anthropic |
| Auth | AWS credentials | API key | API key | API key | None | None | API key |
| Port | N/A | N/A | N/A | N/A | 1234 | 11434 | N/A |
| Stream Format | SSE | SSE | SSE | SSE | SSE | SSE (converted) | SSE |
| Reasoning | N/A | delta.reasoning | N/A | N/A | Multiple formats | think option | reasoning-delta |
| Usage Location | After stream | stream_options | After stream | After stream | stream_options | After stream | After stream |
| Custom Pricing | No (tokenlens) | No (tokenlens) | No (tokenlens) | No (tokenlens) | No | No | Yes (anthropicPricing.ts) |

---

## Testing Checklist

When implementing a new provider:
- [ ] Basic text generation works
- [ ] Streaming displays incrementally
- [ ] Usage metrics display correctly
- [ ] Reasoning/thinking content (if supported) displays in Reasoning component
- [ ] Context window tracking works
- [ ] Error handling for connection failures
- [ ] Model listing works
- [ ] Stop generation works

---

## File Structure

```
server/
├── aisdk-proxy.ts          # Groq & Cerebras
├── anthropic-aisdk-proxy.ts # Anthropic Claude
├── bedrock-aisdk-proxy.ts  # Amazon Bedrock
├── bedrock-proxy.ts        # Legacy Bedrock (model listing)
├── lmstudio-aisdk-proxy.ts # LM Studio chat
├── lmstudio-proxy.ts       # LM Studio SDK (model management)
├── mantle-proxy.ts         # Bedrock Mantle
└── ollama-aisdk-proxy.ts   # Ollama

src/services/
├── api.ts        # APIService (model aggregation, connection checks)
├── aisdk.ts      # Groq/Cerebras/Anthropic (getModels, checkConnection)
├── bedrock.ts    # Bedrock (getModels, checkConnection)
├── lmstudio.ts   # LM Studio (getModels, checkConnection, JIT loading)
├── mantle.ts     # Mantle (getModels, checkConnection)
├── ollama.ts     # Ollama (getModels, checkConnection)
└── types.ts      # Shared types (ModelInfo, LoadProgressEvent)
```


---

## Tavily Web Search Integration (@tavily/ai-sdk)

**Date**: 2026-01-29

**Package**: `@tavily/ai-sdk`

**Setup**:
```typescript
import { tavilySearch } from '@tavily/ai-sdk';
import { stepCountIs, streamText } from 'ai';

// Pass API key when creating the tool
const tools = {
  webSearch: tavilySearch({ apiKey: tavilyApiKey })
};

const result = streamText({
  model: provider(modelId),
  messages,
  tools,
  stopWhen: stepCountIs(5), // Required for multi-step tool use
  abortSignal: abortController.signal, // For cancellation support
});
```

**Key Learnings**:

1. **API Key Passing**: The Tavily API key must be passed directly to `tavilySearch()` function, not via environment variables in the browser context.

2. **stopWhen for Multi-Step Tool Use**: AI SDK v5+ uses `stopWhen: stepCountIs(N)` instead of `maxSteps`. Without it, the model will call the tool but won't continue generating a response based on the tool results.

3. **Stream Part Types**: When using `fullStream`, tool-related parts have these types:
   - `tool-call`: Contains `toolCallId`, `toolName`, `input` (not `args`)
   - `tool-result`: Contains `toolCallId`, `toolName`, `output` (not `result`)
   - `text-delta`: Contains `text` (not `textDelta`)

4. **SSE Format for Tools**: Extended SSE format to include tool events:
   ```
   data: {"content": "Let me search..."}\n\n
   data: {"toolCall": {"id": "...", "name": "webSearch", "args": {...}}}\n\n
   data: {"toolResult": {"id": "...", "name": "webSearch", "result": {...}}}\n\n
   data: {"content": "Based on my search..."}\n\n
   ```

5. **Client-Side Tool Call Handling**: Track pending tool calls and update their status when results arrive. Use a Map to track tool calls by ID.

6. **Abort Signal Support**: Pass `abortSignal` to `streamText()` to support cancellation. On the server, listen for `req.on('close')` to abort when client disconnects.

**Available Tavily Tools**:
- `tavilySearch()` - Real-time web search
- `tavilyExtract()` - Content extraction from URLs
- `tavilyCrawl()` - Website crawling
- `tavilyMap()` - Site structure mapping

**Configuration Options for tavilySearch**:
- `searchDepth`: "basic" | "advanced"
- `topic`: "general" | "news" | "finance"
- `includeAnswer`: boolean
- `maxResults`: number (default: 5)
- `timeRange`: "year" | "month" | "week" | "day"

**Files**:
- `server/aisdk-proxy.ts` - Groq/Cerebras with Tavily
- `server/bedrock-aisdk-proxy.ts` - Bedrock with Tavily
- `server/ollama-aisdk-proxy.ts` - Ollama with Tavily
- `src/components/ai-elements/tool-call.tsx` - Tool call UI component
- `src/components/chat/WebSearchToggle.tsx` - Toggle button

---

## Abort Signal / Stop Generation

**Date**: 2026-01-29

**Key Learnings**:

1. **Server-Side Abort**: Pass `abortSignal` to `streamText()` to enable cancellation:
   ```typescript
   const abortController = new AbortController();
   req.on('close', () => abortController.abort());

   const result = streamText({
     model: provider(modelId),
     messages,
     abortSignal: abortController.signal,
   });
   ```

2. **Client-Side Abort**: Use `AbortController` with fetch and track interrupted state:
   ```typescript
   const abortControllerRef = useRef<AbortController | null>(null);

   const stopGeneration = () => {
     abortControllerRef.current?.abort();
     setWasInterrupted(true);
     setStatus('idle');
   };
   ```

3. **UI Button Type**: When streaming, change submit button from `type="submit"` to `type="button"` to prevent form submission and allow the stop handler to work.

4. **Disabled State**: Keep the stop button enabled during streaming while other controls remain disabled.

**Files**:
- `server/bedrock-aisdk-proxy.ts` - Server-side abort
- `server/aisdk-proxy.ts` - Server-side abort
- `server/ollama-aisdk-proxy.ts` - Server-side abort
- `server/lmstudio-aisdk-proxy.ts` - Server-side abort (fetch signal)
- `src/hooks/useBedrockChat.ts` - Client-side abort + wasInterrupted state
- `src/components/ai-elements/prompt-input.tsx` - Button type switching
- `src/components/chat/ChatContainer.tsx` - InterruptedIndicator component

---

## MCP (Model Context Protocol) Integration (@ai-sdk/mcp)

**Date**: 2026-03-06

**Packages**: `@ai-sdk/mcp`, `@modelcontextprotocol/sdk`

**Setup**:
```typescript
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';

// Stdio (local server)
const client = await createMCPClient({
  transport: new Experimental_StdioMCPTransport({
    command: 'node',
    args: ['server.js'],
    env: { ...process.env, MY_VAR: 'value' },
  }),
});

// HTTP (remote server)
const client = await createMCPClient({
  transport: { type: 'http', url: 'https://server.com/mcp', headers: { Authorization: 'Bearer ...' } },
});

// SSE (remote server)
const client = await createMCPClient({
  transport: { type: 'sse', url: 'https://server.com/sse' },
});

// Get tools compatible with streamText
const tools = await client.tools();
```

**Key Learnings**:

1. **Three Transport Types**: stdio (local child process), HTTP (Streamable HTTP, recommended for production), and SSE (Server-Sent Events). Stdio cannot be deployed to production — local development only.

2. **Client Lifecycle Management**: MCP clients must be explicitly closed. For streaming, close in `onFinish` callback. For non-streaming, use try/finally. Failure to close leaves child processes (stdio) or connections (HTTP/SSE) dangling.

3. **Tool Namespacing is Essential**: When connecting multiple MCP servers, tool name collisions are likely (e.g., two servers both exposing `search`). We prefix tools with `serverName__toolName` using double underscore as separator. The server name is sanitized (lowercase, non-alphanumeric → underscore).

4. **Config-Based Client Caching**: Creating MCP clients is expensive (spawns processes for stdio, establishes connections for HTTP/SSE). Cache clients by server ID with a config hash — reuse if unchanged, recreate if config changed. Hash includes transport-specific fields: command/args/env for stdio, url/headers for HTTP/SSE.

5. **Partial Failure Tolerance**: Use `Promise.allSettled` when connecting to multiple servers. One broken server shouldn't prevent tools from healthy servers from being available. Log warnings for failed connections.

6. **Stdio Transport Import Path**: The stdio transport is at `@ai-sdk/mcp/mcp-stdio`, NOT `@ai-sdk/mcp`. This is an `Experimental_` prefixed export — API may change.

7. **Env Inheritance for Stdio**: Stdio servers often need the parent process's PATH and other env vars. Always spread `process.env` before user-defined env: `{ ...process.env, ...config.env }`.

8. **Tool Merging with Existing Tools**: MCP tools are plain objects compatible with `streamText({ tools })`. They can be spread alongside other tools (e.g., Tavily): `{ ...webSearchTools, ...mcpTools }`. Pass `undefined` (not `{}`) when no tools are configured to avoid unnecessary tool-use behavior.

9. **Cleanup Strategy**: The `cleanup` function returned by `getMCPTools` closes stale clients (those no longer in the active config set) while keeping active ones cached. This runs after every request — on success AND on error.

10. **MCP Servers Config Per-Request**: Configs are sent from client in the request body rather than stored server-side. This keeps the server stateless and the client (localStorage preferences) as the single source of truth.

**Architecture**:
```
Client (useBedrockChat.ts)
  → sends mcpServers[] in request body (enabled servers only)
  → Server proxy (bedrock-aisdk-proxy.ts, etc.)
    → mcp-manager.ts: getMCPTools(configs)
      → creates/reuses cached MCP clients
      → collects namespaced tools from all servers
    → streamText({ tools: { ...webSearchTools, ...mcpTools } })
    → cleanup stale clients after response
```

**Configuration UI**:
Zed editor-inspired form in Preferences → MCP Servers tab:
- Collapsible card per server with transport icon, name, enable/disable toggle
- Transport selector (stdio/HTTP/SSE) with appropriate fields
- Key-value editors for env vars and headers
- Validation indicators for missing required fields

**Common Pitfalls**:
- Forgetting to close MCP clients → leaked child processes (stdio)
- Not handling `mcpServers: undefined` in request body → existing requests break
- Tool name collisions without namespacing → unpredictable tool selection
- Sending `tools: {}` instead of `tools: undefined` → some models enter tool-use mode unnecessarily

**Files**:
- `server/mcp-manager.ts` - Client lifecycle, caching, tool namespacing
- `src/types/mcp.ts` - MCPServerConfig types (stdio/http/sse union)
- `src/components/sidebar/MCPServerSettings.tsx` - Configuration UI
- `src/components/sidebar/PreferencesDialog.tsx` - MCP Servers tab
- `src/utils/preferences.ts` - mcpServers in UserPreferences
- All server proxies (`server/*-proxy.ts`) - MCP tool integration

---

## Claude 4.x Temperature/TopP Mutual Exclusion

**Date**: 2026-03-04

**Affected Models**: All Claude 4.x family — Claude 4, Claude 4.5 (Sonnet/Opus/Haiku), Claude 4.6+

**The Problem**: Claude 4.x models return an error when both `temperature` and `topP` are set in the same request. This is an API-level constraint from Anthropic — you must send one OR the other, never both.

**Detection Regex**: 
```typescript
const isClaude4x = /claude[.-](?:sonnet|haiku|opus)-4(?:[.-]|$)/i.test(modelId);
```

This regex is future-proofed for 4.7, 4.8, etc. It matches model IDs like:
- `anthropic.claude-sonnet-4-20250514-v1:0` (Bedrock)
- `claude-opus-4-5-20251101` (Anthropic direct)
- `us.anthropic.claude-haiku-4-6-20260101-v1:0` (Bedrock inference profile)

**Fix Pattern** (applied in all 4 affected files):
```typescript
...(isClaude4x
  ? temperature !== undefined
    ? { temperature }
    : top_p !== undefined
      ? { topP: top_p }
      : { temperature: 0.3 }  // sensible default
  : {
      temperature: temperature ?? 0.3,
      topP: top_p ?? 0.95,
    }),
```

**Key Learning**: The original code only checked for `sonnet-4-5` as a hardcoded string. When Claude 4.6 was released, the same error reappeared. Using a regex that matches the entire 4.x family prevents this class of regression.

**Files**:
- `server/bedrock-aisdk-proxy.ts`
- `server/bedrock-proxy.ts`
- `server/anthropic-aisdk-proxy.ts`
- `src/hooks/useBedrockChat.ts`
