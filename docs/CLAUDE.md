# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local LLM UI is a React chat interface for interacting with multiple LLM providers: Ollama, LM Studio, Amazon Bedrock, Bedrock Mantle, Anthropic, OpenRouter, Groq, Cerebras, and Kiro (Kiro CLI 3 over the Agent Client Protocol; see `docs/KIRO-PROVIDER.md`). Built with TypeScript, Vite, shadcn/ui (Radix primitives + Tailwind CSS), and Dexie.js for client-side persistence.

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
| `kiro.ts` | Kiro | `POST /api/kiro/models` (a POST: a load can start Kiro CLI), `POST /api/kiro/sessions` and `/open` (the Kiro sessions section), `/api/kiro/status`, sign-in and sign-out, `POST /api/kiro/usage` (account credits) |

### Server Proxies (vite.config.ts → server/)

Vite middleware keeps credentials and SDK calls on the server. Each chat proxy uses the AI SDK `streamText` with the shared tool loop (`tool-loop.ts`), web search tool (`web-search.ts`), and MCP tools (`mcp-manager.ts`). Shared helpers: `security.ts` (`apiGuardPlugin`, the same-origin guard for every `/api` route: keep it the first plugin, add no other `enforce: 'pre'` plugin that serves `/api`, keep `server.cors` off, and add no `GET` that changes state; CORS, body limit, token cap, `endStreamWithError`), `think-tags.ts` (splits inline `<think>` tags into reasoning for Ollama and LM Studio).

- `/api/bedrock` (models), `/api/bedrock-aisdk` (chat, MCP status) → AWS SDK
- `/api/mantle` → Bedrock Mantle (OpenAI-compatible, no AI SDK)
- `/api/anthropic`, `/api/openrouter`, `/api/aisdk` (Groq, Cerebras) → API key in `X-Api-Key`
- `/api/ollama-aisdk`, `/api/lmstudio-aisdk` → local servers through the AI SDK (Ollama provider, OpenAI-compatible provider)
- `/api/lmstudio-sdk` → LM Studio SDK (model list)
- `/api/lmstudio`, `/api/ollama` → plain HTTP proxies
- `/api/kiro` → Kiro CLI (`server/kiro-proxy.ts`). Two layers sit behind it: `server/acp/` is the generic ACP harness layer (agent process, process groups, permissions, update mapping; it has no harness names, and a test checks this), and `server/kiro/` is the Kiro harness adapter. A new harness adds its own adapter folder next to `server/kiro/`.
  - `GET /api/kiro/status` runs `kiro-cli --version` and `kiro-cli whoami -f json` with `execFile` (no shell) and keeps the result 30 s. It also returns `folder` (`{ path, isDefault }`, the folder for new chats, written as `~/…`).
  - `POST /api/kiro/login` runs `kiro-cli login --use-device-flow` and streams the code and the sign-in URL as SSE.
  - `POST /api/kiro/login/cancel` stops the sign-in.
  - `POST /api/kiro/logout` signs out.
  - `POST /api/kiro/models` lists the Kiro models (a POST: a load can start Kiro CLI). It also returns `sessionOptions`: the agent (category `mode`) and the other session options of the short session, with Kiro's default values (`server/kiro/models.ts`).
  - `POST /api/kiro/sessions` lists the Kiro sessions from `session/list` (id, folder name, title, last change, status; never-used sessions are left out; kept 60 s). A POST: it can start Kiro CLI.
  - `POST /api/kiro/sessions/open` loads one session from Kiro's list with replay and returns it as compact messages (JSON, at most 16 MB). It is read only, and it closes the session after the replay (`server/kiro/sessions.ts`, `server/kiro/replay.ts`).
  - `POST /api/kiro/chat` streams a Kiro reply through one shared `kiro-cli acp` (`server/acp/agent.ts` with the Kiro harness in `server/kiro/harness.ts`; the route is `server/kiro/chat.ts`). It gets the new message, the earlier messages, and how many of them the Kiro session has seen (`src/utils/kiroChat.ts`). When Kiro asks to run a tool, it sends a `permission` event with a server-made `requestId` and Kiro's options, and a `permissionResult` event when the question ends (`src/utils/kiroPermissions.ts`). The body may also have `sessionOptions` (id → value, at most 20): the server sets only options that the session lists, to listed values, reads each one back, and sends a `sessionOptions` event with the current options (`server/kiro/chat-options.ts`, `server/acp/session-options.ts`, `src/utils/sessionOptions.ts`; SEC-20).
  - `POST /api/kiro/permission` answers one open Kiro question with `{ requestId, optionId }` (JSON, 1 KB at most; 404 for an unknown or ended question, 400 for an option that the question does not list). The open questions are in `server/acp/permission-registry.ts`. It never starts Kiro CLI.
  - `POST /api/kiro/usage` returns the account plan and credits (`server/kiro/usage.ts`, parser in `src/utils/kiroUsage.ts`). It calls `_kiro/account/getUsage`, keeps the result 5 min for each account (a call stores its result only when its account is still the current one), and does not start Kiro CLI when the status says signed out. A POST: it can start Kiro CLI.
  - `POST /api/kiro/settings` sets the folder for new Kiro chats: `{ workspaceDir: string | null }` (JSON, 4 KB at most; `null` is the default `~/.local-llm-ui/kiro`). The server checks the real path (exists, a folder, owned, writable, not `/`, the home folder, a system folder, or a settings folder) and stores it in `~/.local-llm-ui/kiro-settings.json` (mode 600). The chat body never has a folder (SEC-16, SEC-21). `server/kiro/settings.ts`, shared checks in `src/utils/kiroSettings.ts`. It never starts Kiro CLI.

Code shared by the browser and the server lives in `src/utils/` (`thinkingEffort.ts`, `toolSteps.ts`, `webSearch.ts`, `mediaTypes.ts`, `errorMessage.ts`, `kiroStatus.ts`, `kiroLogin.ts`, `kiroModels.ts`, `kiroChat.ts`, `kiroPermissions.ts`, `kiroSessions.ts`, `sessionOptions.ts`, `kiroSettings.ts`). Keep these free of DOM and Node imports.

### Data Persistence (Dexie.js/IndexedDB)

- `src/db/schema.ts` - Database schema (conversations, messages, savedPrompts). Version 3 adds the index `kiro.sessionId` on conversations (K7)
- `src/services/conversationService.ts` - Conversation CRUD
- `src/services/kiroImport.ts` - Import a Kiro session as a conversation, and add the turns that were made in the terminal
- `src/services/promptsService.ts` - Saved prompts operations

### Component Structure

- `src/layout/AppShell.tsx` - Main orchestrator, manages state
- `src/layout/AppLayout.tsx` - Layout wrapper with sidebar
- `src/components/chat/ChatContainer.tsx` - Chat UI container
- `src/components/chat/SessionAgentPicker.tsx`, `SessionOptionsMenu.tsx` - The **Agent** picker (ACP category `mode`) and the **Options** menu for a Kiro chat (K9). `SessionAgentList.tsx` is the agent list that the picker and the default agent row share
- `src/components/sidebar/KiroFolderSetting.tsx`, `KiroDefaultAgent.tsx` - The "Folder for new Kiro chats" and "Default agent" rows of the Kiro row in Preferences (KD, `KiroChatDefaults.tsx` renders both)
- `src/components/ai-elements/` - Reusable AI UI components (prompt-input, message, model-selector, reasoning, context)
- `src/components/sidebar/Sidebar.tsx` - Conversation list, saved prompts, preferences
- `src/components/ui/` - shadcn/ui components

### Key Hooks

- `useAllModels.ts` - Aggregates models from all providers
- `useBedrockChat.ts` - Chat state and streaming for every provider. The state of a running reply is not in the hook: it lives in `src/utils/replyStore.ts`, keyed by conversation id, so a reply keeps running when you open another chat. A run writes only through its own handle, and every database write of a reply uses the reply's own conversation id.
- `useReplies.ts` - `useReply(id)` and `useReplyActivity()` read the reply store with `useSyncExternalStore` (the reply of the open chat, and the sidebar words "Replying…" and "Waiting for your answer"). The toast rules are in `src/utils/replyNotice.ts` (`REPLY_NOTICE_RULES`), and `src/services/replyNotices.ts` shows the toast (the **Open** action only for a chat that is not on screen)
- `useConversation.ts`, `useConversations.ts` - Conversation state/CRUD
- `useSavedPrompts.ts` - Saved prompts with Dexie reactive queries
- `useKiroSessions.ts` - The Kiro sessions list (focus and 60 s refresh), import, and sync of terminal turns
- `useSessionOptions.ts` - The agent and options of the open chat: lists from the last snapshot, values from the conversation (`kiro.options`), the picks that no reply has applied yet, and for a new chat the default agent from `preferences.kiroDefaultAgent`

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
