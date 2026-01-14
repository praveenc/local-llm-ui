# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local LLM UI is a React chat interface for interacting with multiple LLM providers: Ollama, LM Studio, Amazon Bedrock, Bedrock Mantle, Groq, and Cerebras. Built with TypeScript, Vite, shadcn/ui (Radix primitives + Tailwind CSS), and Dexie.js for client-side persistence.

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

### Provider Service Pattern

The app uses `APIService` (`src/services/api.ts`) to orchestrate provider-specific services. Each service implements: `getModels()`, `chat()` (async generator for streaming), `checkConnection()`.

| Service | Provider | Port/Target |
|---------|----------|-------------|
| `ollama.ts` | Ollama | localhost:11434 |
| `lmstudio.ts` | LM Studio | localhost:1234 |
| `bedrock.ts` | AWS Bedrock | AWS SDK (server proxy) |
| `mantle.ts` | Bedrock Mantle | OpenAI-compatible |
| `aisdk.ts` | Groq, Cerebras | Vercel AI SDK |

### Server Proxies (vite.config.ts)

Custom Vite middleware handles AWS credentials and SDK operations server-side:
- `/api/bedrock`, `/api/bedrock-aisdk` → AWS SDK calls
- `/api/mantle` → Bedrock Mantle
- `/api/lmstudio-sdk` → LM Studio SDK operations
- `/api/lmstudio`, `/api/ollama` → Direct proxies

### Data Persistence (Dexie.js/IndexedDB)

- `src/db/schema.ts` - Database schema (conversations, messages, savedPrompts)
- `src/services/conversationService.ts` - Conversation CRUD
- `src/services/promptsService.ts` - Saved prompts operations

### Component Structure

- `src/layout/AppShell.tsx` - Main orchestrator, manages state
- `src/layout/AppLayout.tsx` - Layout wrapper with sidebar
- `src/components/chat/ChatContainer.tsx` - Chat UI container
- `src/components/ai-elements/` - Reusable AI UI components (prompt-input, message, model-selector, reasoning, context)
- `src/components/sidebar/Sidebar.tsx` - Provider/model selection, conversation list
- `src/components/ui/` - shadcn/ui components

### Key Hooks

- `useAllModels.ts` - Aggregates models from all providers
- `useConversation.ts`, `useConversations.ts` - Conversation state/CRUD
- `usePromptOptimizer.ts` - Claude 4.5 prompt optimization (Bedrock only)
- `useSavedPrompts.ts` - Saved prompts with Dexie reactive queries

## Code Conventions

- **Commits**: Conventional Commits (`feat(scope):`, `fix(scope):`, `refactor(scope):`)
- **Components**: shadcn/ui (Radix UI + Tailwind), functional with hooks
- **TypeScript**: Strict mode, avoid `any`, use type imports (`import type { T }`)
- **Path alias**: `@/` maps to `src/`
- **Pre-commit**: Husky runs lint-staged (ESLint + Prettier)

## Provider-Specific Notes

- **Claude 4.5 models**: Don't support both `temperature` and `top_p` simultaneously; UI provides radio toggle
- **Bedrock document upload**: PDF, TXT, HTML, MD, CSV, DOC(X), XLS(X); max 4.5MB per file
- **LM Studio**: Supports JIT model loading with progress tracking via SDK
