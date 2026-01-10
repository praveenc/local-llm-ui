# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local LLM UI is a React chat interface for interacting with multiple LLM providers: Ollama, LM Studio, Amazon Bedrock, Groq, and Cerebras. Built with TypeScript, Vite, shadcn/ui, and Tailwind CSS.

## Common Commands

```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # TypeScript check + production build
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
npm run test:ui      # Run tests with UI
make check           # Run lint + tests (quiet output)
make fix             # Run format + lint-fix (quiet output)
```

## Architecture

### Provider Service Pattern

The app uses a unified API service (`src/services/api.ts`) that orchestrates multiple provider-specific services:

- `ollama.ts` - Ollama API (localhost:11434)
- `lmstudio.ts` - LM Studio API (localhost:1234)
- `bedrock.ts` - AWS Bedrock via server proxy
- `mantle.ts` - Bedrock Mantle (OpenAI-compatible)
- `aisdk.ts` - Groq and Cerebras via Vercel AI SDK

Each service implements: `getModels()`, `chat()` (async generator for streaming), `checkConnection()`.

### Server Proxies

Vite dev server includes custom middleware proxies in `vite.config.ts`:
- `/api/bedrock` → AWS SDK calls (handles credentials server-side)
- `/api/mantle` → Bedrock Mantle proxy
- `/api/lmstudio-sdk` → LM Studio SDK operations
- `/api/lmstudio` → Direct proxy to localhost:1234
- `/api/ollama` → Direct proxy to localhost:11434

### Data Persistence

Uses Dexie.js (IndexedDB wrapper) for client-side storage:
- `src/db/schema.ts` - Database schema (conversations, messages, savedPrompts)
- `src/services/conversationService.ts` - Conversation CRUD operations
- `src/services/promptsService.ts` - Saved prompts operations

### Key Component Structure

- `src/layout/AppShell.tsx` - Main orchestrator component
- `src/components/chat/ChatContainer.tsx` - Chat UI container
- `src/components/chat/AIChatInput.tsx` - Message input with file attachments
- `src/components/sidebar/Sidebar.tsx` - Provider/model selection sidebar

### Hooks

- `useConversation.ts` / `useConversations.ts` - Conversation state management
- `usePromptOptimizer.ts` - Claude 4.5 prompt optimization feature
- `useModelLoader.ts` - LM Studio model loading with progress
- `useSavedPrompts.ts` - Saved prompts with Dexie hooks

## Code Conventions

- Follow Conventional Commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`
- Use shadcn/ui components (Radix UI primitives + Tailwind CSS)
- TypeScript strict mode; avoid `any`
- Use type imports: `import type { Type } from 'module'`
- Functional components with hooks only
- Husky pre-commit runs lint-staged (ESLint + Prettier)

## Testing

Tests use Vitest with React Testing Library. Test files are co-located with source:
- `src/services/__tests__/api.test.ts`
- `src/utils/__tests__/fileUtils.test.ts`

Run a single test file: `npm test -- src/services/__tests__/api.test.ts`

## Container Requirement

**All git operations (commit, push, tag) must run inside the git-workspace container.**

### Setup
1. **Check if running**: `docker ps --filter name=my-git-workspace --format '{{.Names}}'`
2. **Start only if not running**: `docker compose run -d --rm --name my-git-workspace git-workspace`

### Verify Git Identity

Before any commit, verify git config:

```bash
docker exec my-git-workspace git-test
```

Expected: username `praveenc`, email `1090396+praveenc@users.noreply.github.com`

### Running Git Commands

```bash
docker exec my-git-workspace git -C /workspace/repos/copt <command>
docker exec my-git-workspace gh <command>
```

Repo path inside container: `/workspace/repos/local-llm-ui`

## Provider-Specific Notes

- **Claude 4.5 models**: Don't support both `temperature` and `top_p` simultaneously
- **Bedrock document upload**: Supports PDF, TXT, HTML, MD, CSV, DOC(X), XLS(X); max 4.5MB per file
- **LM Studio**: Supports JIT model loading with progress tracking via SDK
