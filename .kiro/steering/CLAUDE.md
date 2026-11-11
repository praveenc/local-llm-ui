# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local LLM UI is a React chat interface for interacting with multiple LLM providers: Ollama, LM Studio, Amazon Bedrock, Bedrock Mantle, Anthropic, OpenRouter, Groq, and Cerebras. Built with TypeScript, Vite, shadcn/ui (Radix primitives + Tailwind CSS), and Dexie.js for client-side persistence.

## Commands

```bash
# Development
npm run dev              # Start dev server (http://localhost:5173)
npm run build            # TypeScript check + production build

# Quality
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format

# Testing
npm run test             # Watch mode
npm run test:run         # Single run
npm run test:ui          # With Vitest UI
npm test -- path/file.test.ts  # Single test file

# Make shortcuts (quiet output)
make check               # lint + test:run
make fix                 # format + lint:fix
```

## Architecture

### Provider Services (browser)

`src/services/*.ts` list the models of each provider (`getModels()`). `useAllModels.ts` calls them in parallel. The chat does not go through these services: `useBedrockChat.ts` posts to the provider's server proxy and reads one SSE format from all of them (`content`, `reasoning`, `toolCall`, `toolResult`, `metadata`, `error`).

| Service | Provider | Models from |
|---------|----------|-------------|
| `ollama.ts` | Ollama | `/api/ollama/api/tags` |
| `lmstudio.ts` | LM Studio | `/api/lmstudio-sdk/models`, then `/api/lmstudio/v1/models` |
| `bedrock.ts` | Amazon Bedrock | `/api/bedrock/models` |
| `mantle.ts` | Bedrock Mantle | `/api/mantle/models` |
| `aisdk.ts` | Groq, Cerebras, Anthropic | `/api/aisdk/models` (Anthropic: static list) |
| `openrouter.ts` | OpenRouter | `/api/openrouter/models` |

### Server Proxies (vite.config.ts → server/)

Vite middleware keeps credentials and SDK calls on the server. Each chat proxy uses the AI SDK `streamText` with the shared tool loop (`tool-loop.ts`), web search tool (`web-search.ts`), and MCP tools (`mcp-manager.ts`). Shared helpers: `security.ts` (CORS, body limit, token cap, `endStreamWithError`), `think-tags.ts` (splits inline `<think>` tags into reasoning for Ollama and LM Studio).

- `/api/bedrock` (models), `/api/bedrock-aisdk` (chat, MCP status) → AWS SDK
- `/api/mantle` → Bedrock Mantle (OpenAI-compatible, no AI SDK)
- `/api/anthropic`, `/api/openrouter`, `/api/aisdk` (Groq, Cerebras) → API key in `X-Api-Key`
- `/api/ollama-aisdk`, `/api/lmstudio-aisdk` → local servers through the AI SDK (Ollama provider, OpenAI-compatible provider)
- `/api/lmstudio-sdk` → LM Studio SDK (model list)
- `/api/lmstudio`, `/api/ollama` → plain HTTP proxies

Code shared by the browser and the server lives in `src/utils/` (`thinkingEffort.ts`, `toolSteps.ts`, `webSearch.ts`, `mediaTypes.ts`, `errorMessage.ts`). Keep these free of DOM and Node imports.

### Data Persistence (Dexie.js/IndexedDB)

- `src/db/schema.ts` - Database schema (conversations, messages, savedPrompts)
- `src/services/conversationService.ts` - Conversation CRUD
- `src/services/promptsService.ts` - Saved prompts operations

### Component Structure

- `src/layout/AppShell.tsx` - Main orchestrator, manages state
- `src/layout/AppLayout.tsx` - Layout wrapper with sidebar
- `src/components/chat/ChatContainer.tsx` - Chat UI container
- `src/components/ai-elements/` - Reusable AI UI components (prompt-input, message, model-selector, reasoning, context)
- `src/components/sidebar/Sidebar.tsx` - Conversation list, saved prompts, preferences
- `src/components/ui/` - shadcn/ui components

### Key Hooks

- `useAllModels.ts` - Aggregates models from all providers
- `useBedrockChat.ts` - Chat state and streaming for every provider
- `useConversation.ts`, `useConversations.ts` - Conversation state/CRUD
- `useSavedPrompts.ts` - Saved prompts with Dexie reactive queries

## Code Conventions

- **Commits**: Conventional Commits (`feat(scope):`, `fix(scope):`, `refactor(scope):`)
- **Components**: shadcn/ui (Radix UI + Tailwind), functional with hooks
- **TypeScript**: Strict mode, avoid `any`, use type imports (`import type { T }`)
- **Path alias**: `@/` maps to `src/`
- **Pre-commit**: Husky runs lint-staged (ESLint + Prettier)

## Provider-Specific Notes

- **Sampling parameters**: The app does not send `temperature` or `top_p` (UI or proxies). Claude 4.7+ rejects them ("`temperature` is deprecated for this model"); all models use their own defaults
- **Bedrock document upload**: PDF, TXT, HTML, MD, CSV, DOC(X), XLS(X); max 4.5MB per file
- **LM Studio**: Turn on JIT Loading in the LM Studio server settings; the app does not load models itself

## Container Requirement

**All git operations (commit, push, tag) must run inside the git-workspace container.**

### Setup

1. **Check if running**: `docker ps --filter name=my-git-workspace --format '{{.Names}}'`
2. **Start only if not running**: `docker compose run -d --rm --name my-git-workspace git-workspace`

### Verify Git Identity

Before any commit, verify git config:

```bash
docker exec my-git-workspace sh -c "cat ~/.gitconfig.local"
```

Expected: username `praveenc`, email `1090396+praveenc@users.noreply.github.com`

### Running Git Commands

```bash
docker exec my-git-workspace git -C /workspace/repos/local-llm-ui <command>
docker exec my-git-workspace gh <command>
```

Repo path inside container: `/workspace/repos/local-llm-ui`

## Testing, Linting, Formatting and Build

Always use targets provided in the Makefile for the above operations

```bash
make check              # Quick validation(minimal output)

make fix                # Auto-fix issues
make check VERBOSE=1    # Full output for debugging
make build TAIL_LINES=5 # Even less output
```