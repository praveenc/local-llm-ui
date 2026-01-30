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
- Claude 4.5 models don't support both `temperature` and `top_p` simultaneously
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
2. Claude 4.5 models require either `temperature` OR `topP`, not both
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
