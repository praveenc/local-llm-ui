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

| Feature | Bedrock | Mantle | Groq | Cerebras | LM Studio | Ollama |
|---------|---------|--------|------|----------|-----------|--------|
| Package | @ai-sdk/amazon-bedrock | fetch (OpenAI) | @ai-sdk/groq | @ai-sdk/cerebras | @ai-sdk/openai-compatible | ollama-ai-provider-v2 |
| Auth | AWS credentials | API key | API key | API key | None | None |
| Port | N/A | N/A | N/A | N/A | 1234 | 11434 |
| Stream Format | SSE | SSE | SSE | SSE | SSE | SSE (converted) |
| Reasoning | N/A | delta.reasoning | N/A | N/A | Multiple formats | think option |
| Usage Location | After stream | stream_options | After stream | After stream | stream_options | After stream |

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
├── bedrock-aisdk-proxy.ts  # Amazon Bedrock
├── bedrock-proxy.ts        # Legacy Bedrock (model listing)
├── lmstudio-aisdk-proxy.ts # LM Studio chat
├── lmstudio-proxy.ts       # LM Studio SDK (model management)
├── mantle-proxy.ts         # Bedrock Mantle
└── ollama-aisdk-proxy.ts   # Ollama

src/services/
├── api.ts        # APIService (model aggregation, connection checks)
├── aisdk.ts      # Groq/Cerebras (getModels, checkConnection)
├── bedrock.ts    # Bedrock (getModels, checkConnection)
├── lmstudio.ts   # LM Studio (getModels, checkConnection, JIT loading)
├── mantle.ts     # Mantle (getModels, checkConnection)
├── ollama.ts     # Ollama (getModels, checkConnection)
└── types.ts      # Shared types (ModelInfo, LoadProgressEvent)
```
