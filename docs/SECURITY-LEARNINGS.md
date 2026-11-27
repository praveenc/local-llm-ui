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

### SEC-10: Connection Timeout and Process Cleanup (LOW)

**Risk**: An MCP server that does not answer blocks a chat request. A server process that the app does not close keeps running, with the user's rights, after nothing uses it.

**Hardening** (`server/mcp-manager.ts`):

- The AI SDK's `initializationOptions.timeout` limits the start to 15 s. On a timeout or any other failed start, the SDK closes the transport, which ends the child process. (Before Plan 3, a `Promise.race` timer rejected the start and left the child running.)
- The tool listing has the same 15 s limit (`listTools` with `options.timeout`). A timeout there closes the client.
- A child that ignores SIGTERM gets SIGKILL after 2 s.
- One start for each server id and config. A second request waits for the same start, so two requests cannot start two processes.
- When a stdio process stops, its client leaves the cache. The next check or chat starts it again. The app never restarts a server by itself.
- A status check closes the client of a disabled server after it lists its tools (the **Check** button can check a disabled server). With `closeOthers: true` (the MCP popover sends it with the full list of servers), the check also closes the servers that are no longer in the list. Leases stop a cleanup from closing a client that another request uses.
- The browser starts no server while the user types: it checks on page load, when Preferences closes, when the MCP popover opens, and with **Check**. It sends only servers that pass `validateMCPServerConfig`.

**Limit**: the SDK spawns with no process group, so the app can signal only its direct child. `npx` (`npm exec`) passes SIGTERM on to the server, so no process stays. A wrapper that does not pass it on leaves the server running. A test records both cases.

**Error output in the UI**: the app keeps the last 4 KB of each child's stderr and puts its last 6 lines (at most 400 characters) in the error that the status route returns. The terminal still gets each line, with `[MCP <name>]` in front (control characters removed). Only the app's own pages can read the route (SEC-13). A server that writes a secret to stderr shows it in the popover, as it already did in the terminal.

### SEC-11: Runtime Config Validation (LOW)

**Risk**: TypeScript types only enforce at compile time. Malformed JSON from the request body passes through unchecked.

**Hardening**: `validateConfigStructure()` + `validateMCPConfig()` run before client creation:
- Checks `id`, `name`, `transport` are strings
- Validates transport-specific fields: `command`/`args` for stdio, `url` for http/sse
- Then runs SEC-01/02/03 security checks per transport type
- The error names only the server and its id: `Invalid MCP config for server "<name>" (<id>)`. Before Plan 3, it put the first 200 characters of the config in the error, with environment values and headers, and the status route returned it.

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

- **Tools ask, as in the terminal.** The app does not change `autopilot`. A new or loaded session keeps Kiro's default: Autopilot is on, reads run without a question, and shell commands and file writes ask. Each question goes to the browser, and the user answers it (SEC-17). The app does not answer for the user. It picks an option by `kind` only in the cases that it ends itself: a cancelled reply answers `cancelled` at once, and a question with no answer for 10 minutes gets `reject_once`. With no prompt handler, the generic agent denies the question.
- **No lock on the agent or Autopilot (D17).** Until K6, `server/kiro/autopilot.ts` kept Autopilot off and the default agent. K6 removes it, because the user's direction is that kiro-cli owns permissions (D15). This is safe enough because: (1) Kiro still asks before a shell command or a file write, and the user answers; (2) the chat body sets only `model`, `effortLevel`, `thinking`, and the session options that Kiro lists, to listed values only (SEC-16, SEC-20); (3) a request from another site cannot reach the routes (SEC-13). The risk that stays: a default agent with its own allow rules, or an **Always allow** rule, runs a tool with no question. This is the same as `kiro-cli` in a terminal. The generic `SessionGuard` hook in `server/acp/agent.ts` stays for a harness that needs a lock, and no harness sets it.
- **Nothing else from the agent.** Every other request from Kiro to the app gets JSON-RPC error `-32601` at once, so the app gives Kiro no file system or terminal access of its own (`clientCapabilities` `fs` and `terminal` are `false`).
- **Own folder.** New sessions run in `~/.local-llm-ui/kiro` (mode `0700`), not in the app's repository. The user can choose a different folder with a server setting (SEC-21).
- **No shell.** `spawn` with fixed arguments: `acp --agent-engine v3 --auth-method cli`.
- **Stop the whole tree.** The engine runs in process groups of its own. The app records these groups while the process runs (after start, each session open, and each reply start), and a stop also reads them with `ps` before it closes stdin. Then it sends `SIGTERM` and `SIGKILL` to each group, never to the app's own group or groups 0 and 1. After a crash, the app stops the recorded groups, because `ps` cannot find the children of a dead process. The same runs when the app exits, also on Ctrl+C and a closed terminal (`server/acp/process-end.ts`). The process also stops after 10 idle minutes. Accepted risk: between the record and the signal, a group number can belong to a new group of the same user. The time is short, and the number must belong to a new group leader.
- **Environment.** `kiro-cli acp` gets the environment of the dev server, as in a terminal, so that Kiro finds its credentials, `PATH`, and the user's MCP servers. Kiro's shell tools see the same variables, also API keys that you exported in the shell that runs `npm run dev`. Shell commands ask before they run, but a command that an **Always allow** rule covers runs with no question (see above).
- **Limits.** One JSON-RPC line may be at most 64 MB. `initialize` and `session/new` time out after 30 s, `session/load` after 120 s, and a reply that ignores `session/cancel` for 30 s stops the process.
- **Logs.** Only lifecycle lines (started, stopped, exited). No prompt text, tool input, or account data.

### SEC-16: The Kiro Chat Route

`POST /api/kiro/chat` (`server/kiro/chat.ts`, with `chat-options.ts` and `approvals.ts`) and `POST /api/kiro/models` (`server/kiro/models.ts`). The rules:

- **No folder from the browser.** A new session runs in `~/.local-llm-ui/kiro`, or in the folder that the user set in the server setting of SEC-21. The chat request has no folder field. An existing session runs in the folder of its own `session.json` (`server/kiro/session-files.ts`): the session id must match `sess_<uuid>`, the bucket folder must be 16 hex characters, the `id` in the file must match, and the SHA-256 of the folder must give the bucket name. So the request cannot name a folder or reach a path outside `~/.kiro/sessions`.
- **Only listed options, to listed values.** `server/kiro/chat-options.ts` sets only `model`, `effortLevel`, `thinking`, and the session options that Kiro lists (the agent and options such as Autopilot, see SEC-20). Each value must be one that the session lists. No other id reaches `set_config_option`.
- **Tools.** `server/kiro/approvals.ts` turns each permission question into an SSE event, and the user answers it (SEC-17). The route sends `: ping` every 15 s while a question is open, so a tunnel does not close the stream.
- **Sizes.** The body is at most 10 MB, the message at most 200,000 characters, the history at most 2,000 messages, and the context block that the server puts before the message at most 400,000 characters (older messages are left out, and a long message is cut).
- **Changes state, so a POST.** A model-list load can start Kiro CLI and make and delete a session, so the route is a `POST` with JSON, not a `GET` (SEC-13).
- **Errors.** The browser gets plain text. Unknown errors say "Kiro failed. See the terminal that runs npm run dev.", and the detail goes to the terminal. No folder path goes to the browser.
- **Logs.** One line per reply: the stop reason and the time. No message text, history, tool input or output, or title.

### SEC-17: Kiro Tool Approvals

Kiro asks before it runs a shell command or writes a file. The question goes through `server/acp/permission-registry.ts` (generic) and `server/kiro/approvals.ts` and `server/kiro/permission-route.ts` (Kiro). The rules:

- **A POST with JSON, small.** `POST /api/kiro/permission` takes `{ requestId, optionId }`. It goes through the guard (SEC-13). The body is at most 1 KB (`readBodyWithLimit`), and a larger body gets 413. Any other method gets 405. The route only answers a question that is open. It never starts Kiro CLI, and it changes no state when nothing is open.
- **The server's id, not Kiro's.** Each question gets a random UUID (`randomUUID`) when it arrives. The browser never sees Kiro's JSON-RPC id, so a request cannot target a Kiro id. The route accepts only a lower-case UUID. A bad body gets 400.
- **Only Kiro's options.** The registry keeps the options of the question. It accepts an `optionId` that the question lists and gives 400 for any other. The answer is the option id of Kiro's own list, and the app never builds one.
- **One answer.** The first valid answer wins, and the registry forgets the question. A second answer, or an answer to a question that has ended, gets 404. Two clicks cannot answer one question twice.
- **Every question ends.** **Stop**, a closed stream, a closed page, and a crash abort the question, and the answer to Kiro is `cancelled` (Kiro counts one Deny, and ignores a late answer). The 10-minute limit answers `reject_once`. Each question that the browser saw gets a `permissionResult`, and the browser ends every question that is still open when the stream ends. The registry holds no question after the prompt ends.
- **Plain text.** The command, title, and path in a question are cut to 2,000 characters on the server and in the browser parser. The browser shows them as text, never as HTML.
- **The whole command before an answer (K11a).** The question shows the command as Kiro sent it, up to 2,000 characters, with its line breaks, in a box that scrolls. It is never cut at a shorter length. When Kiro sent a longer command, the browser parser marks it (`commandCut`), and the question says that only the start shows. So the user never allows a command whose end is hidden without being told. The one-line `aria-label` is cut at 80 characters, but the visible command is not.
- **Logs.** One line for each answer with the result only (`answered`, `unknown`, `invalid-option`). No id, option, command, path, or tool input.
- **Idle stream.** A question can wait 10 minutes. The chat route sends `: ping` every 15 s while a question is open.
- **What still asks.** Shell commands and file writes ask, with Kiro's default agent and Autopilot on. A file write also asks "Review changes" when Autopilot is off. The app has no rule of its own: Kiro keeps **Always allow** and **Always deny** for the session, and a new session asks again.
- **What does not ask.** Reads, the tools that the default agent allows, and a command that an **Always allow** rule covers. This is Kiro's choice and is the same in a terminal (SEC-15).
- **Accepted risk.** Any page of the app can answer any open question, because the app has no user accounts. The id is random, and another site cannot call the route (SEC-13). Share the app only through an authenticated tunnel, as SEC-13 says. Someone who can open the app can also tell Kiro to run a command, so the answer route adds no new access.

### SEC-18: The Kiro Sessions Routes

`POST /api/kiro/sessions` and `POST /api/kiro/sessions/open` (`server/kiro/sessions.ts`, with `replay.ts`, `lease.ts`, and the generic `listSessions`, `replaySession`, and `closeSession` in `server/acp/agent.ts`). The parsers and limits that the browser and the server share are in `src/utils/kiroSessions.ts`. The rules:

- **Two routes, both `POST` with JSON.** A call can start Kiro CLI, so a `GET` answers 405 (SEC-13). The body is at most 1 KB. The guard of SEC-13 runs first, so a cross-site `POST` gets 403 and a body that is not JSON gets 415.
- **Folder name only.** The server reads `cwd` from `session/list` and sends the browser only the last part of it (`folder`). The browser never sends a folder. The open route loads the session in the `cwd` that Kiro lists for the id.
- **Ids from Kiro's list.** The id must match `sess_<uuid>` (400 otherwise) and must be in Kiro's own list (404 otherwise). So a request cannot name a session that Kiro does not list, and cannot reach a path.
- **Only the fields that the app needs.** The server keeps the id, the folder, the title, the last change, and the status of each session, and drops every other field when it parses the list. `_meta.kiro.customAgents` (13 MB of 14 MB) and the other `_meta` fields never reach the cache or the browser. The list has at most 2,000 sessions, newest first. One `session/list` runs at a time, and the parsed list is kept 60 s.
- **The replay is read only.** `session/load` with replay does not change the session files (checked with SHA-256 on the largest session). The replayed session is not added to the live sessions, so the app sends it no prompt, and it uses no tool. The server collects the updates as they come and keeps only compact turns. The load has the 120 s time limit of SEC-15. A replay for a session that answers a prompt now gets 409.
- **Response limits.** Tool output is cut to 8,000 characters, each string of tool arguments to 2,000, one message to 400,000, and the thinking of one reply to 100,000. The response has at most 16 MB of JSON. The server adds turns from the newest back, and says how many older turns it left out. The server leaves out images and counts them. Kiro's text is stored as text and shown through the same Markdown rendering as other replies.
- **Close after the reply, not after an error.** The chat route sends `session/close` after a prompt that ended, so the terminal can resume the session. It does not close after a failed prompt, because another program can hold the lease, and a close must not touch it. A replay closes only the session that it loaded. With kiro-cli 3.6.1, a close by a program that does not hold the lease did not remove the lease of the program that holds it.
- **No lock in the app.** When another program holds the session, the chat shows Kiro's own text (cut to 300 characters, in single spaces). The text names the other program and its process number, and no path.
- **Errors and logs.** The browser gets plain words in `{ error }`: "Kiro has no session with this id.", "Kiro is answering in this session. Try again when the reply ends.", and "Kiro could not open this session. See the terminal that runs npm run dev." The terminal gets the counts and the times: the sessions kept and all sessions, and for an import the turns, the messages, the bytes, and the time. No title, folder, message text, tool input or output, or session id is logged.
- **Browser storage.** An import writes the conversation and its messages in one Dexie transaction and checks again that the session is not imported. **Delete** removes the conversation from the app only (D13): Kiro's files are not touched.

### SEC-19: The Kiro Account Credits Route

`POST /api/kiro/usage` (`server/kiro/usage.ts`) returns the plan and the credits of the signed-in Kiro account. The rules:

- **Account data goes only to the app's pages.** The route is behind the same-origin guard (SEC-13). A cross-site request gets 403.
- **Not logged.** The server never logs the plan, the credits, or the email. A failed call logs one line with the error class only.
- **A POST, because it can start Kiro CLI.** The call needs a running `kiro-cli acp`. The route accepts only `POST` with JSON and a body of at most 1 KB. Other methods get 405 and do not start Kiro CLI (SEC-13).
- **No start when signed out.** The server reads the cached status first. When Kiro is signed out or missing, it returns `{ "usage": null }` and does not start Kiro CLI.
- **Known fields only.** The parser in `src/utils/kiroUsage.ts` keeps only the fields that it knows, with the right types. It gives `null` for any other shape.
- **Errors.** Any failure gives `{ "usage": null }`. The browser gets no error text and no path.
- **Cache.** The server keeps the result 5 minutes and runs one call at a time. The app does not keep it in storage.
- **One account per call.** Each call keeps the account key that was current when it started. Its result goes into the cache only under that key, and only when that account is still the current one when the call ends. A read under a different account does not share the running call. So the credits of one account never show for another account.

### SEC-20: Kiro Session Options

The `sessionOptions` field of `POST /api/kiro/chat` sets the agent and the other options of a Kiro session. The code is in `server/kiro/chat-options.ts` and the generic `server/acp/session-options.ts`. The parser and the snapshot helpers that the browser and the server share are in `src/utils/sessionOptions.ts`. The rules:

- **What the body may set.** `model`, `effortLevel`, `thinking`, and the session options that Kiro lists. For each option, the value must be one that the option lists. A request cannot set an option that the session does not list, and it cannot set an option that an app control owns (the model and the Thinking level) through `sessionOptions`.
- **A small, strict field.** `parseSessionOptionsRequest` keeps at most 20 entries. The id and the value are strings of 1 to 200 characters with no control characters, and `__proto__`, `constructor`, and `prototype` are not accepted as ids. The parser drops any other entry and gives no error.
- **Listed values only, checked before the send.** Kiro takes an unlisted value without an error and changes the session (K9 probe): an unlisted Autopilot value turned Autopilot off, and an unlisted agent reset the session to the default agent. So `checkOptionChange` compares each value with the current list of the session just before it sends the value, and the agent goes first, because it can change the list. A value that the option does not list fails the reply with a plain text, and nothing goes to Kiro. An unknown id or an owned id is dropped, and the log shows only the count.
- **Read back.** After each change, the agent reads the value from Kiro. If Kiro did not take it, the reply fails with "Kiro did not change Autopilot. Try again.", with Kiro's name of the option.
- **Terminal changes stay.** A request on a live session sends only the picks that the user made. The generic agent does not remember these values, so a later `session/load` does not set them again (`remember: false`). The app does not undo a change that the user made in a terminal (D15).
- **The agent has its own rules.** An agent can have its own allow rules that run tools without a question. The user picks the agent in the list that Kiro gives, as in the terminal, and the app does not check the rules of the agent (D15, D17). The risk is the same as with `kiro-cli` in a terminal. A request cannot pick an agent that Kiro does not list. Shell commands and file writes still ask with Kiro's default agent (SEC-17).
- **Autopilot.** Turning Autopilot off adds questions: a file write asks for the write and then for "Review changes", and both go through the approval route (SEC-17). Turning it on removes only the "Review changes" step.
- **Only the sites of the app.** The same-origin guard runs first (SEC-13). A cross-site `POST` gets 403 and a body that is not JSON gets 415. Anyone who can open the app can pick an agent or change an option, as anyone who can open it can answer a question (SEC-17). Share the app only through an authenticated tunnel.
- **Compact data to the browser.** `compactSessionOption` keeps the id, the name (at most 120 characters), the description (at most 300), the current value, and at most 200 values with a name and a description. Kiro's `_meta` (the agent sources and paths) never goes to the browser, and a test checks it. The browser checks each snapshot with `parseSessionOptionsSnapshot` before it uses it.
- **Browser storage.** The conversation stores only the current values (`kiro.options`), not the lists. A pick that no reply has applied yet is stored next to it as `kiroPicks` (K11c). After a reload, each stored pick is checked against Kiro's lists before it is used or sent, and a value that Kiro no longer lists is dropped. While the lists are not known, nothing from storage is sent. The server still checks each value (the rules above).
- **A refresh of the lists (K11c).** `POST /api/kiro/models` takes `refreshOptions`, which must be the boolean `true`; any other value means no refresh. It makes one short session and deletes it, as the first load does. The browser allows one refresh a minute, and the server runs one load at a time and shares it. It does not read the status again. The route keeps its other rules (SEC-16).
- **Process-wide options are not replayed (K11c).** Kiro keeps `contentCollection` for the whole kiro-cli process. The Kiro harness names it, and the snapshot marks it with `scope: 'process'`. A new session never gets a stored value of such an option, so one chat cannot silently undo a change that another chat or a terminal made. A pick that the user made and did not send yet is still sent.
- **Errors and logs.** The browser gets plain text with Kiro's name of the option, and never the value that it sent. The terminal gets the count of dropped options. No id, value, or agent name is logged.

### SEC-21: The Folder for New Kiro Chats

`POST /api/kiro/settings` (`server/kiro/settings.ts`, route in `server/kiro-proxy.ts`) sets the folder in which new Kiro chats run. The checks that the browser and the server share are in `src/utils/kiroSettings.ts`. The rules:

- **A server setting, not a chat field.** The chat request never names a folder (SEC-16). The folder is stored on the server in `~/.local-llm-ui/kiro-settings.json` as `{ "workspaceDir": "<real path>" }`. No file, or `null`, means the default folder `~/.local-llm-ui/kiro`. The app makes the settings folder with mode `0700`, and sets `0700` on a real settings folder that has a looser mode. The file has mode `0600`. The file is outside Kiro's work folder. The server writes a temp file in the same folder and renames it, one write at a time.
- **A POST with JSON, small, no Kiro start.** The body is `{ workspaceDir: string | null }` and at most 4 KB (`readBodyWithLimit`). The guard of SEC-13 runs first, so a cross-site `POST` gets 403 and a body that is not JSON gets 415. A `GET` or any other method gets 405. The route never starts Kiro CLI.
- **The server checks every value.** The string has at most 1,024 characters and no control, format, or line-separator characters. A leading `~/` means the home folder. The path must be absolute. Then the server resolves the real path (`realpath`) and requires:
  - the folder exists, is a directory, is owned by the current user, and the user can write to it;
  - it is not `/`, not the home folder itself, and not a folder that holds the home folder;
  - it is not a system folder or inside one: on Linux `/etc /usr /bin /sbin /lib /lib32 /lib64 /boot /dev /proc /sys /run /var /snap`, and on macOS also `/System /Library /private /Applications /Volumes`. The list is not checked inside the real home folder, so a home in `/var/home` or `/private` still works;
  - it is not inside `~/.kiro`, `~/.aws`, `~/.ssh`, `~/.config`, or `~/.local-llm-ui`, and it does not hold one of them. The server checks both the literal path and the real path of each of these folders, so a settings folder that is a symlink (a dotfile manager) gives the same result. The default folder (`~/.local-llm-ui/kiro`) and the folders inside it pass the `~/.local-llm-ui` rule only. They must still pass the rules for `~/.kiro`, `~/.aws`, `~/.ssh`, `~/.config`, the home folder, and the system folders. The server checks the real path, so a default folder that is a symlink to a folder that holds `~/.ssh` is refused.
- **The real path is stored.** A symlink in the typed value is resolved before the checks, so a link to `/etc` is refused. The default folder, when typed, is stored as `null`. The server never creates a folder other than the default.
- **Checked again at each new chat.** The disk can change after the save. At each new session, `workspaceDir()` resolves the stored path and runs the checks again. If the folder is gone, is no longer the same real path, or fails a check, the chat fails with "The folder for new Kiro chats is not available. Choose a different folder in Preferences." It never falls back to the default folder, because that would run tools in a folder that the user did not pick. The model list uses the same folder and shows the same text.
- **Only new chats.** An existing session runs in the folder of its own `session.json` (SEC-16). A Kiro process starts in the default folder, and only `session/new` gets the stored folder, so a change needs no restart.
- **Settings file.** The server reads the file with `lstat`: it must be a regular file of at most 4 KB, owned by the user. A bad or missing file gives the default folder and one log line with no path or content.
- **Status.** `GET /api/kiro/status` (read only) also returns the folder, written as `~/…` when it is inside the home folder. It reads the cached setting or the small file, never creates a folder, and never starts Kiro CLI.
- **Errors and logs.** The browser gets plain words in `{ error }`, for example "This folder does not exist.", "Choose a folder that you own.", "Kiro cannot use your home folder itself. Choose a folder inside it.", "Kiro cannot use a system folder.", and "Choose a folder outside your settings folders." The terminal gets `saved` or `refused` and no path.
- **A linked folder keeps its mode (K11b, D28).** `ensurePrivateDir()` reads the path with `lstat` before `mkdir`. It sets `0700` only on a folder that it makes now or on a real directory. A `~/.local-llm-ui` or a work folder that is a symlink is followed, and its owner is checked with `stat` (a link to a folder of another user is refused), but the mode of its target is not changed. The settings file and its temp file stay `0600`. Only `ENOENT` from `lstat` means "missing"; any other error gives the generic "Could not save the folder. Try again." with no path. The harness uses the same rule for the default work folder, and logs the folder only to the terminal. A same-user process can swap a path for a link between `lstat` and `chmod`; the limits below accept this kind of race.
- **Accepted risk.** Any page of the app can change the folder, because the app has no user accounts. The same-origin guard stops other sites (SEC-13), and the app must be shared only through an authenticated tunnel. This is the same as SEC-17. Kiro's tools still ask before they run a command or write a file, but Kiro reads files without a question, and the folder does not limit what Kiro can read or reach when the user answers a question. The folder is the place where Kiro starts, not a sandbox.
- **Limits of the checks.** The checks stop a mistake of the user, for example a system folder or a settings folder. They do not stop a person who can already run commands as the same user. A folder can change between the check and the moment that Kiro opens it, because Kiro opens it itself. A `~/.local-llm-ui` that is a symlink is followed when the app writes the setting (see the next rule).

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
