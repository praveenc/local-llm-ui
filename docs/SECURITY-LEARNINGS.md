# Security Learnings

This document captures security findings, hardening patterns, and best practices discovered while building local-llm-ui — a React + Node.js application that proxies requests to multiple LLM providers and integrates with MCP (Model Context Protocol) servers.

**First audit date**: 2026-03-06  
**Framework**: OWASP Top 10 for LLMs (2025) + Node.js security + MCP-specific risks

---

## Table of Contents

- [Architecture Security Model](#architecture-security-model)
- [MCP Security (Critical Surface)](#mcp-security-critical-surface)
- [Server Proxy Hardening](#server-proxy-hardening)
- [Client-Side Security](#client-side-security)
- [Common Pitfalls](#common-pitfalls)
- [Shared Security Utilities](#shared-security-utilities)
- [OWASP LLM Top 10 Relevance](#owasp-llm-top-10-relevance)
- [Positive Practices](#positive-practices)
- [Deferred Items](#deferred-items)
- [Audit History](#audit-history)

---

## Architecture Security Model

### Three-Layer Defense

```
┌─────────────────────────────────────────────────┐
│  Layer 1: ui-implementer (every change)         │
│  Lightweight checklist — 6 quick checks         │
│  Flags concerns with ⚠️ SECURITY marker          │
├─────────────────────────────────────────────────┤
│  Layer 2: security-reviewer (on demand)         │
│  Full 3-category audit (OWASP LLM + Node + MCP) │
│  Run when: new endpoints, MCP changes, auth     │
├─────────────────────────────────────────────────┤
│  Layer 3: pre-pr-review chain (before merge)    │
│  security-reviewer → github-pr pipeline         │
│  Security findings appear in PR description     │
└─────────────────────────────────────────────────┘
```

### Trust Boundaries

```
Browser (untrusted)
  → HTTP request body (untrusted — user can modify via devtools)
    → Vite dev server proxy (server/*.ts)
      → MCP stdio child process (semi-trusted — user-configured)
      → MCP HTTP/SSE remote server (untrusted — arbitrary URL)
      → LLM provider API (trusted — AWS, Anthropic, etc.)
    → Response to browser (must sanitize)
```

**Key principle**: Everything from the client request body is untrusted. MCP configs, model names, temperature values, tool arguments — all must be validated server-side.

---

## MCP Security (Critical Surface)

MCP is the highest-risk integration because it involves spawning child processes and making outbound HTTP requests based on user-controlled configuration.

### SEC-01: Command Injection Prevention (CRITICAL)

**Risk**: User-controlled `command` and `args` in stdio MCP configs are passed to `Experimental_StdioMCPTransport`, which spawns a child process.

**Hardening applied** (`server/mcp-manager.ts`):

1. **Command allowlist** — only these bare commands are permitted:
   ```typescript
   const ALLOWED_STDIO_COMMANDS = new Set([
     'node', 'npx', 'python', 'python3', 'uvx', 'uv',
     'docker', 'deno', 'bun', 'bunx',
   ]);
   ```

2. **No path separators** — blocks `/usr/bin/evil` or `../../evil`:
   ```typescript
   if (cmd.includes('/') || cmd.includes('\\')) {
     throw new Error('[MCP Security] Command paths are not allowed');
   }
   ```

3. **Shell metacharacter validation on args** — blocks `; rm -rf /`:
   ```typescript
   const SHELL_METACHAR_PATTERN = /[;&|`$(){}!<>]/;
   ```

**To add a new allowed command**: Add it to `ALLOWED_STDIO_COMMANDS` in `server/mcp-manager.ts`.

### SEC-02: Environment Variable Leak Prevention (HIGH)

**Risk**: `{ ...process.env, ...userEnv }` leaks AWS credentials, API keys, and all server-side secrets to MCP child processes.

**Hardening applied**:
```typescript
const SAFE_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM',
  'SHELL', 'NODE_ENV', 'TMPDIR', 'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
];
```

Only these env vars are inherited. User-supplied env vars from the MCP config are merged on top.

**Never do this**:
```typescript
// ❌ BAD — leaks AWS_SECRET_ACCESS_KEY, etc.
env: { ...process.env, ...config.env }

// ✅ GOOD — explicit allowlist
env: { ...getSafeEnv(), ...config.env }
```

### SEC-03: SSRF Protection for Remote MCP Servers (HIGH)

**Risk**: User-configured HTTP/SSE MCP server URLs can target internal services, cloud metadata endpoints, or localhost.

**Hardening applied** (`server/mcp-manager.ts: validateUrlSecurity()`):

| Blocked Target | Why |
|---------------|-----|
| `169.254.169.254` | AWS EC2/ECS metadata — credential theft |
| `169.254.170.2` | ECS task metadata endpoint |
| `metadata.google.internal` | GCP metadata |
| `localhost`, `127.0.0.1`, `[::1]` | Local services |
| `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` | RFC 1918 private IPs |
| `169.254.x.x` | Link-local addresses |
| Non-http/https schemes | `file://`, `ftp://`, etc. |
| HTTP redirects | AI SDK 7 MCP transports default to `redirect: 'error'`, so a validated URL cannot redirect to a blocked target |

### SEC-10: Connection Timeout (LOW)

**Risk**: Unresponsive MCP servers block chat requests indefinitely.

**Hardening**: 15-second timeout via `Promise.race`:
```typescript
const MCP_CONNECT_TIMEOUT_MS = 15_000;

async function createClientWithTimeout(config): Promise<MCPClient> {
  return Promise.race([
    createClient(config),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), MCP_CONNECT_TIMEOUT_MS)
    ),
  ]);
}
```

### SEC-11: Runtime Config Validation (LOW)

**Risk**: TypeScript types only enforce at compile time. Malformed JSON from the request body passes through unchecked.

**Hardening**: `validateConfigStructure()` + `validateMCPConfig()` run before client creation:
- Checks `id`, `name`, `transport` are strings
- Validates transport-specific fields: `command`/`args` for stdio, `url` for http/sse
- Then runs SEC-01/02/03 security checks per transport type

---

## Server Proxy Hardening

### SEC-05: CORS Restriction

**Before**: `Access-Control-Allow-Origin: *` on all proxies — any website could make requests.

**After** (`server/security.ts: setCORSHeaders()`):
```typescript
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);
```

Only recognized dev server origins get the CORS header. Same-origin requests (no `Origin` header) always work.

**Superseded in part by SEC-13**: the guard now rejects every cross-origin request to `/api`, also from the origins in this list, before a proxy can set the header.

**For custom headers** (e.g., Mantle API key):
```typescript
setCORSHeaders(req, res, 'Content-Type, X-Mantle-Api-Key, X-Mantle-Region');
```

### SEC-07: Request Body Size Limits

**Before**: All proxies used unbounded `body += chunk` — multi-GB body = OOM.

**After** (`server/security.ts: readBodyWithLimit()`):
- Default limit: **10MB**
- Returns `null` and sends `413 Payload Too Large` if exceeded
- Applied to all 10 proxy body-reading paths

```typescript
const body = await readBodyWithLimit(req, res);
if (body === null) return; // 413 already sent
```

### SEC-09: maxOutputTokens Cap

**Before**: Client-supplied `max_tokens` passed through uncapped — could set 1,000,000.

**After** (`server/security.ts: capMaxTokens()`):
- Default: **2,048** tokens
- Cap: **32,768** tokens
- Applied to all 6 proxy files that set `maxOutputTokens` / `max_tokens`

```typescript
maxOutputTokens: capMaxTokens(request.max_tokens), // Math.min(val ?? 2048, 32768)
```

### SEC-13: Same-Origin Guard

**Before**: SEC-05 only stopped another site from *reading* a response. The request itself still ran. A page on any site could send a form post, or a `fetch` with `mode: 'no-cors'` and a `text/plain` body, to `http://localhost:5173/api/...`. These are "simple" requests, so the browser sends them without a preflight. The proxies parsed the body as JSON whatever its `Content-Type` was. So the page could:

- start a chat that used the host's AWS credentials or API keys;
- send `mcpServers` to `/api/bedrock-aisdk/mcp-status` or a chat route, and so start an allowed MCP command such as `npx -y <package>` on the host;
- send requests to Ollama and LM Studio through `/api/ollama` and `/api/lmstudio`.

**After** (`server/security.ts: checkApiRequest()`, `createApiGuard()`, `apiGuardPlugin()`): one middleware checks every HTTP request to `/api` before any proxy:

1. When the request has `Sec-Fetch-Site`, the value must be `same-origin` or `none` (a typed URL). Browsers set this header, and a page cannot change it. `same-site` is rejected too, so another app on a different `localhost` port cannot call the API.
2. When the request has no `Sec-Fetch-Site` but has `Origin` (older browsers, or a plain-HTTP address that is not `localhost`), the Origin host must equal `Host`. For an `https` Origin, `X-Forwarded-Host` can match too. The tunnel sends `Host: localhost:5173` and its public `https` host in `X-Forwarded-Host`, and it replaces any `X-Forwarded-Host` that the client sends.
3. `POST`, `PUT`, `PATCH`, and `DELETE` must have `Content-Type: application/json`. A cross-site page cannot send JSON without a preflight, and the preflight fails rule 1 or 2.

A request that fails rule 1 or 2 gets `403 {"error":"Cross-site request blocked"}`. A request that fails rule 3 gets `415`. The server logs one line for each rejected request. Requests with neither header (curl, scripts) are not from a browser and pass rules 1 and 2.

The guard reads the path in two forms: the raw `req.url`, as most proxies match it, and the path after `new URL()`, as the OpenRouter proxy reads it (`/./api/x`, `/a/../api/x`, and `http://host/api/x` all become `/api/x`). Upper case counts too.

```typescript
// vite.config.ts
plugins: [apiGuardPlugin(), tailwindcss(), react(), /* provider proxies */],
server: { cors: false, /* ... */ },
preview: { cors: false, /* ... */ },
```

**Order matters**:

- Vite adds the middlewares of `configureServer` and `configurePreviewServer` in plugin order, sorted by `enforce`, and all of them before `server.proxy` and `preview.proxy`. The guard uses `enforce: 'pre'` and is the first plugin. Do not add another plugin with `enforce: 'pre'` or `order: 'pre'` that serves `/api`.
- Vite's own CORS middleware runs before every plugin. It answers preflights from any `localhost` port with `Access-Control-Allow-Origin`. In a browser without `Sec-Fetch-Site`, a page on another port could then add a forged `X-Forwarded-Host`. `server.cors` and `preview.cors` are `false`, so preflights reach the guard and get 403. The app calls only its own origin, so it does not need Vite's CORS.

`server/__tests__/api-guard.test.ts` starts real Vite servers in a child process: a test config with `server.proxy` and `preview.proxy`, and the app's own `vite.config.ts`. It checks that a cross-site post never reaches a proxy, that the guard runs first, and that a preflight from another `localhost` port fails.

**Rules for new routes**:

- A `GET` under `/api` must not change state. Older browsers send a cross-site `GET` (for example from `<img>`) without `Origin` or `Sec-Fetch-Site`, so rules 1 and 2 cannot stop it.
- A WebSocket upgrade does not go through the middleware, so the guard does not see it. A route that accepts upgrades must check `Origin` itself.

**What the guard does not do**: it does not authenticate. Anyone who can open the app in a browser can use it. Keep the dev server on `localhost`, and share it only through an authenticated tunnel.

### SEC-14: Running Kiro CLI

`server/kiro/` runs `kiro-cli` on the host (`run.ts`, `status.ts`, `login.ts`, `binary.ts`). The generic ACP code in `server/acp/` starts no program by itself: the Kiro harness (`server/kiro/harness.ts`) gives it the command. The rules:

- **No shell.** `execFile` with fixed arguments (`--version`, `whoami -f json`). No value from a request goes into the arguments.
- **Known binary.** `LOCAL_LLM_UI_KIRO_CLI`, else `~/.local/bin/kiro-cli`, else `PATH`. The file must be a regular, executable file. A bad `LOCAL_LLM_UI_KIRO_CLI` is an error, not a silent fallback to another binary.
- **Time limits.** 5 s for `--version` and 15 s for `whoami`, then `SIGKILL`. This kills only the direct child. The two short commands end by themselves. The long-running `kiro-cli acp` process for chat must run in its own process group, and a stop must end the whole group.
- **Environment.** The child gets the environment of the dev server, as in a terminal. Kiro CLI needs `HOME`, `PATH`, and `KIRO_API_KEY` when set.
- **Account data.** `GET /api/kiro/status` returns the account email. Only the app's own pages can read it (SEC-13). The server does not log it.
- **Sign-in arguments.** `POST /api/kiro/login` builds the arguments of `kiro-cli login --use-device-flow` only from a validated method: the start URL must be `https` on `*.awsapps.com`, `*.awsapps.cn`, or `*.app.aws`, with no user name, password, port, white space, control characters, or format characters (such as a right-to-left override), and the Region must match the Region pattern. Kiro CLI gets the normalized URL (`new URL(value).href`), the value that the app checked. The same checks run in the browser and on the server (`src/utils/kiroLogin.ts`).
- **Sign-in page.** The server sends the sign-in URL to the browser only when it is `https` on `*.awsapps.com` or `*.awsapps.cn`, on the host of the given start URL, or on `device.sso.<Region>.amazonaws.com` for the given Region. Any other URL stops the sign-in. The browser checks the URL again before it opens the tab, and it cuts `window.opener`. The code and the URL are never logged.
- **Sign-in process.** The login runs as its own process group, because `~/.local/bin/kiro-cli` can be a wrapper. Cancel, a closed browser tab (the response closes), a 10-minute time limit, and the end of the dev server stop the whole group. The end of the dev server includes Ctrl+C and a closed terminal: Node does not run its `exit` listeners for `SIGINT` and `SIGHUP`, so `server/acp/process-end.ts` adds listeners for them that kill the groups and then send the signal again. The group also gets `SIGKILL` after `kiro-cli login` ends, so that no process of a wrapper stays. Only one sign-in or sign-out runs at a time, and **Cancel** names the run (`runId`) that it stops.
- **Idle connections.** The sign-in stream sends a comment line (`: ping`) every 15 s, so a tunnel or a proxy does not close the connection while you approve the sign-in. A closed connection cancels the sign-in.
- **Read only.** The status route is a `GET` and must not change state (SEC-13). Sign-in and sign-out are `POST` with JSON.

### SEC-15: The Kiro Agent Process

`server/acp/agent.ts` runs one long-lived `kiro-cli acp` for all Kiro chats, with the Kiro harness in `server/kiro/harness.ts`. Kiro is a coding agent: its tools can read and change files and run shell commands in the session folder. The rules:

- **Tools ask.** Each new or loaded session gets `autopilot` set to `off`, and the app reads the value back. The app checks the value again after every option change and every `config_option_update` from Kiro. If Autopilot is on, the app cancels the reply of that session, turns Autopilot off again, and uses the session only after it reads `off` back. A session that the app made in that call and that fails the check is deleted. A session from disk is never deleted: the app stops using it. Until the approval UI lands, the default answer to `session/request_permission` is **Deny** (`reject_once`). Options are chosen by `kind`, never by id. A cancelled reply answers `cancelled` at once, and a question with no answer for 10 minutes gets **Deny**.
- **No agent change.** The app cannot set `autopilot` or `mode` (the agent) through `setOption`. An agent can have its own allow rules that run tools without a question, so the app keeps Kiro's default agent. The lock is in `server/kiro/autopilot.ts`, and `server/acp/agent.ts` enforces it. The generic agent has no lock of its own: the Kiro harness passes it (until K6).
- **Nothing else from the agent.** Every other request from Kiro to the app gets JSON-RPC error `-32601` at once, so the app gives Kiro no file system or terminal access of its own (`clientCapabilities` `fs` and `terminal` are `false`).
- **Own folder.** New sessions run in `~/.local-llm-ui/kiro` (mode `0700`), not in the app's repository.
- **No shell.** `spawn` with fixed arguments: `acp --agent-engine v3 --auth-method cli`.
- **Stop the whole tree.** The engine runs in process groups of its own. The app records these groups while the process runs (after start, each session open, and each reply start), and a stop also reads them with `ps` before it closes stdin. Then it sends `SIGTERM` and `SIGKILL` to each group, never to the app's own group or groups 0 and 1. After a crash, the app stops the recorded groups, because `ps` cannot find the children of a dead process. The same runs when the app exits, also on Ctrl+C and a closed terminal (`server/acp/process-end.ts`). The process also stops after 10 idle minutes. Accepted risk: between the record and the signal, a group number can belong to a new group of the same user. The time is short, and the number must belong to a new group leader.
- **Environment.** `kiro-cli acp` gets the environment of the dev server, as in a terminal, so that Kiro finds its credentials, `PATH`, and the user's MCP servers. Kiro's shell tools see the same variables, also API keys that you exported in the shell that runs `npm run dev`. Tools ask before they run (see above).
- **Limits.** One JSON-RPC line may be at most 64 MB. `initialize` and `session/new` time out after 30 s, `session/load` after 120 s, and a reply that ignores `session/cancel` for 30 s stops the process.
- **Logs.** Only lifecycle lines (started, stopped, exited). No prompt text, tool input, or account data.

### SEC-16: The Kiro Chat Route

`POST /api/kiro/chat` (`server/kiro/chat.ts`, with `chat-options.ts` and `approvals.ts`) and `POST /api/kiro/models` (`server/kiro/models.ts`). The rules:

- **No folder from the browser.** A new session runs in `~/.local-llm-ui/kiro`. An existing session runs in the folder of its own `session.json` (`server/kiro/session-files.ts`): the session id must match `sess_<uuid>`, the bucket folder must be 16 hex characters, the `id` in the file must match, and the SHA-256 of the folder must give the bucket name. So the request cannot name a folder or reach a path outside `~/.kiro/sessions`.
- **Only three options.** `server/kiro/chat-options.ts` sets only `model`, `effortLevel`, and `thinking`, and only to a value that the session lists. `autopilot` and `mode` are locked (SEC-15).
- **Tools.** `server/kiro/approvals.ts` gives each permission question `reject_once` until K6 (SEC-15).
- **Sizes.** The body is at most 10 MB, the message at most 200,000 characters, the history at most 2,000 messages, and the context block that the server puts before the message at most 400,000 characters (older messages are left out, and a long message is cut).
- **Changes state, so a POST.** A model-list load can start Kiro CLI and make and delete a session, so the route is a `POST` with JSON, not a `GET` (SEC-13).
- **Errors.** The browser gets plain text. Unknown errors say "Kiro failed. See the terminal that runs npm run dev.", and the detail goes to the terminal. No folder path goes to the browser.
- **Logs.** One line per reply: the stop reason and the time. No message text, history, tool input or output, or title.

---

## Client-Side Security

### API Keys in localStorage (Known Limitation)

Five API keys + MCP auth headers are stored in plaintext `localStorage`. This is inherent to the local-first, no-backend-auth architecture.

**Mitigations in place**:
- Keys sent via `X-Api-Key` headers (not URLs — won't appear in logs/history)
- AWS credentials use server-side provider chain (never sent from client)
- rehype-sanitize on LLM output rendering (reduces XSS → key theft chain)

**Future consideration**: `sessionStorage` (cleared on tab close) or encrypted storage with user passphrase.

### LLM Output Rendering

- **Markdown**: Rendered via `Streamdown` which uses `rehype-sanitize` — robust XSS mitigation
- **Code blocks**: Rendered via Shiki syntax highlighter (trusted processor, not raw HTML)
- **`dangerouslySetInnerHTML`**: Only used in `code-block.tsx` for Shiki output — NOT for raw LLM content

---

## Common Pitfalls

### 1. Never Spread process.env

```typescript
// ❌ Leaks all server secrets to child processes
env: { ...process.env, ...userEnv }

// ✅ Explicit allowlist
env: { ...getSafeEnv(), ...userEnv }
```

### 2. Never Use CORS Wildcard

```typescript
// ❌ Any website can hit your API
res.setHeader('Access-Control-Allow-Origin', '*');

// ✅ Import and use the shared utility
import { setCORSHeaders } from './security';
setCORSHeaders(req, res);
```

### 3. Always Limit Request Body Size

```typescript
// ❌ Unbounded — OOM with large payload
let body = '';
for await (const chunk of req) { body += chunk; }

// ✅ Size-limited with 413 response
const body = await readBodyWithLimit(req, res);
if (body === null) return;
```

### 4. Always Cap Token Output

```typescript
// ❌ User can request 1M tokens
maxOutputTokens: request.max_tokens

// ✅ Capped
maxOutputTokens: capMaxTokens(request.max_tokens)
```

### 5. Never Trust Client-Sent MCP Configs

MCP configs arrive in the request body from `localStorage`. They are user-modifiable via browser devtools. Always validate server-side before creating clients.

### 6. Never Force-Add Gitignored Files

Security reports, PR drafts, and temp docs live in `docs/tmp_docs/` (gitignored). Never use `git add -f` to commit them — they may contain vulnerability details.

### 7. Sanitize Error Messages

```typescript
// ❌ May contain AWS account IDs, ARNs, internal paths
res.end(JSON.stringify({ error: err.message, errorDetail: err.stack }));

// ✅ Sanitized
res.end(JSON.stringify({ error: 'Internal server error' }));
console.error('Full error (server-side only):', err); // log server-side
```

---

## Shared Security Utilities

All shared utilities live in `server/security.ts`:

| Function | Purpose | Used By |
|----------|---------|---------|
| `apiGuardPlugin()` | Vite plugin that rejects cross-site and non-JSON requests to `/api` (SEC-13) | `vite.config.ts`, first plugin, `enforce: 'pre'` |
| `checkApiRequest(req)` | The rules of the guard; returns `null` or a 403/415 rejection | `createApiGuard()` |
| `setCORSHeaders(req, res, headers?)` | Restrict CORS to dev server origins | All proxies with CORS |
| `readBodyWithLimit(req, res, maxSize?)` | Read body with 10MB limit, returns null + 413 on overflow | All proxies reading bodies |
| `capMaxTokens(requested?)` | Cap maxOutputTokens at 32,768, default 2,048 | All proxies with token params |

MCP-specific security functions live in `server/mcp-manager.ts`:

| Function | Purpose |
|----------|---------|
| `validateStdioSecurity(config)` | Command allowlist + arg metachar check |
| `getSafeEnv()` | Safe env var allowlist for child processes |
| `validateUrlSecurity(url)` | SSRF protection for HTTP/SSE URLs |
| `validateConfigStructure(config)` | Runtime type validation |
| `validateMCPConfig(config)` | Combined structure + security validation |

---

## OWASP LLM Top 10 Relevance

How each OWASP LLM risk maps to this project:

| OWASP Risk | Relevance | Status |
|------------|-----------|--------|
| **LLM01: Prompt Injection** | MCP tool results flow back into LLM context — indirect injection vector | ⚠️ Architecture-level concern |
| **LLM02: Sensitive Info Disclosure** | process.env leak to MCP, API keys in localStorage, verbose errors | ✅ SEC-02 fixed, SEC-04/08 noted |
| **LLM03: Supply Chain** | npm dependencies, MCP servers from untrusted sources | ✅ npm audit clean, command allowlist |
| **LLM05: Improper Output Handling** | LLM markdown rendered in browser | ✅ rehype-sanitize in place |
| **LLM06: Excessive Agency** | MCP tools executed without confirmation | ⚠️ No human-in-the-loop yet |
| **LLM07: System Prompt Leakage** | No secrets in system prompts | ✅ N/A — no system prompts with secrets |
| **LLM10: Unbounded Consumption** | No rate limiting, uncapped tokens | ✅ SEC-09 fixed, SEC-06 deferred |

---

## Positive Practices

Things this project does well:

1. **AWS credentials via provider chain** — never sent from client, never exposed
2. **API keys on headers** — not URLs, won't appear in server logs or browser history
3. **rehype-sanitize for markdown** — XSS mitigation for LLM output
4. **Abort signal support** — all proxies abort on client disconnect, preventing wasted API calls
5. **MCP tool namespacing** — `serverName__toolName` prevents collisions
6. **`Promise.allSettled` for MCP** — one broken server doesn't take down the rest
7. **File upload filename sanitization** — dangerous characters stripped
8. **0 npm audit vulnerabilities** — clean dependency tree
9. **Lock file committed** — reproducible builds
10. **`.env` properly gitignored** — secrets not in version control

---

## Deferred Items

Items identified but not yet implemented (long-term):

| Item | Finding | Reason for Deferral |
|------|---------|-------------------|
| Rate limiting | SEC-06 | Needs middleware pattern redesign for Vite dev server |
| Error message sanitization | SEC-08 | Lower risk for local dev server; needs per-proxy audit |
| sessionStorage for API keys | SEC-04 | Architecture-level UX change (keys cleared on tab close) |
| CSP/security headers | SEC-12 | Not applicable to Vite dev server; needed for production |
| Human-in-the-loop for MCP tools | LLM06 | Significant UX/architecture work |
| MCP tool output sandboxing | LLM01 | Requires framework-level support |
| zod 3.x inside `@lmstudio/sdk` (GHSA-mrhx-c7xc-m3w5, high) | Dependency | No patched zod 3 exists. `@lmstudio/sdk` 2.1.0 (latest) needs zod 3 and fails at import with zod 4 (`innerType is not a function`). It only parses responses from the local LM Studio server, not user input. Revisit when the SDK moves to zod 4. |

---

## Audit History

| Date | Scope | Findings | Fixed |
|------|-------|----------|-------|
| 2026-03-06 | Full project (first audit) | 14 (1C, 3H, 5M, 2L, 3I) | 8 of 14 |
| 2026-11-24 | `/api` routes before the Kiro provider | 1 (SEC-13: cross-site requests reach the proxies, including the MCP command start) | 1 of 1 |

---

## File Structure

```
server/
├── security.ts             # Shared: same-origin guard, CORS, body limits, token cap
├── mcp-manager.ts          # MCP: command allowlist, env allowlist, SSRF, timeout, validation
├── kiro-proxy.ts           # Kiro routes (uses security.ts)
├── acp/                    # Generic ACP layer: agent process, process groups, permissions (no harness names)
├── kiro/                   # Kiro harness: kiro-cli commands, sign-in, chat route, approvals
├── aisdk-proxy.ts          # Groq/Cerebras (uses security.ts)
├── anthropic-aisdk-proxy.ts # Anthropic (uses security.ts)
├── bedrock-aisdk-proxy.ts  # Bedrock AI SDK (uses security.ts)
├── bedrock-proxy.ts        # Legacy Bedrock (uses security.ts)
├── lmstudio-aisdk-proxy.ts # LM Studio chat (uses security.ts)
├── lmstudio-proxy.ts       # LM Studio SDK (inline limits)
├── mantle-proxy.ts         # Bedrock Mantle (uses security.ts)
└── ollama-aisdk-proxy.ts   # Ollama (uses security.ts)
```
