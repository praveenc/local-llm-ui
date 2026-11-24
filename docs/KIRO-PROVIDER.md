# Kiro provider

Status: approved, in progress. All decisions take the recommended option (2026-11-24). See [Progress](#progress) for the state of each PR. Last updated 2026-11-24.

This document plans Kiro as a provider. Kiro is not an HTTP API. It is a local agent (`kiro-cli`) that the app starts as a child process and talks to with the Agent Client Protocol (ACP): JSON-RPC, one message per line, on stdin and stdout. Kiro keeps its own login, model list, sessions on disk, tools, and credits. The app must fit these into its existing patterns: one model picker, one chat view, one work row, one SSE format.

The plan supports kiro-cli 3 only. kiro-cli 2 gets a clear message and no Kiro features.

## Contents

- [Decisions](#decisions)
- [Progress](#progress)
- [What kiro-cli 3 does](#what-kiro-cli-3-does)
- [How Kiro fits the app](#how-kiro-fits-the-app)
- [Items](#items)
- [Found during the planning](#found-during-the-planning)
- [Delivery plan](#delivery-plan)
- [Not in this plan](#not-in-this-plan)

## Decisions

| # | Question | Decision | Effect on the plan |
|---|---|---|---|
| D1 | Which `kiro-cli` does the app run? | Approved: (a). The one the user runs in the terminal: `LOCAL_LLM_UI_KIRO_CLI` if set, else `~/.local/bin/kiro-cli`, else `kiro-cli` on `PATH`. It keeps the same behaviour as the terminal, also when `~/.local/bin/kiro-cli` is a wrapper script. ACP works through such a wrapper (`initialize` 1.2 s, against 1.1 s direct). | K2 |
| D2 | Which versions are supported? | Approved: (a). 3.0.0 and later. The app uses only the options that each version sends. Below 3.0.0 the app shows "Kiro CLI 2 is not supported". | K2 |
| D3 | How does sign-in work? | Approved: (a). Always the device flow (`kiro-cli login --use-device-flow`). The app opens the sign-in page in a new tab with the code in the URL. It works on this computer and through a tunnel. | K3 |
| D4 | Which sign-in choices show? | Approved: (a). AWS Builder ID and IAM Identity Center (start URL and Region). | K3 |
| D5 | One Kiro process or one per chat? | Approved: (a). One shared `kiro-cli acp` process for all Kiro chats. It starts on the first Kiro request and stops after 10 idle minutes. One process holds many sessions (checked: `session/new` and `session/load` on one connection). A crash stops all live Kiro replies, and the next message reloads each session. | K4 |
| D6 | Which folder does a new Kiro chat use? | Approved: (a). One app folder, `~/.local-llm-ui/kiro`, with a Preferences field to change it. A folder chip per chat can come later. Imported sessions always use their own folder. | K5 |
| D7 | Does Kiro ask before it runs a tool? | Approved: (a). Ask by default. The work row shows the request with Allow, Always allow, and Deny. Preferences can change it to Autopilot. Until K6 merges, K5 denies every request, so no tool runs without a question. | K5, K6 |
| D8 | How does the Thinking menu map to Kiro? | Approved: (a). Add **Max** to the menu, shown only for models that have it. Other levels map to the nearest level of the model, as today. **Off** turns thinking off, or sends `none`, or the lowest level. | K5 |
| D9 | Which Kiro agent do chats use? | Approved: (a). Kiro's default agent. A **Default agent** select in Preferences is a later item. | K5 |
| D10 | Where do Kiro chats show in the sidebar? | Approved: (a). **Conversations** holds every chat that you used in this app, also Kiro chats. A **Kiro sessions** section lists the sessions on disk that you have not opened here yet. When you open one, the app imports it and it moves to **Conversations**. Every chat has one place, and the Kiro section works as an import list. | K7 |
| D11 | When does the app ask about the sessions on disk? | Approved: (a). After sign-in, the Kiro row in Preferences asks "Show your Kiro sessions in the sidebar?" with **Show** and **Not now**. A switch below keeps the choice. | K7 |
| D12 | How do mixed chats, fork, and regenerate work? | Approved: (a). Before each Kiro prompt, the app sends the earlier messages that Kiro has not seen, once, as context. This covers a switch to Kiro in the middle of a chat, **Send to Fork**, and a switch back after another model. **Regenerate** and edit are hidden on Kiro replies. | K5 |
| D13 | What does **Delete** do on a Kiro chat? | Approved: (a). It removes the chat from the app only. Kiro's files stay. | K5, K7 |
| D14 | Own ACP client or the ACP SDK? | Approved: (a). A small own client, about 150 lines, with the message types copied from KiroBoo. | K4 |

## Progress

| PR | Branch | Items | State |
|---|---|---|---|
| K1 | `fix/api-same-origin` | 1 | Done, merged ([#76](https://github.com/praveenc/local-llm-ui/pull/76)) |
| K2 | `feat/kiro-detect` | 2 | In review ([#77](https://github.com/praveenc/local-llm-ui/pull/77)) |
| K3 | `feat/kiro-sign-in` | 3 | Planned |
| K4 | `feat/kiro-acp-client` | 4 | Planned |
| K5 | `feat/kiro-chat` | 5 | Planned |
| K6 | `feat/kiro-approvals` | 6 | Planned |
| K7 | `feat/kiro-sessions` | 7 | Planned |
| K8 | `feat/kiro-credits` | 8 | Planned |

### Found during the work

- **Vite's CORS answered preflights from other ports (K1).** Vite's default CORS middleware runs before every plugin and allows any `localhost` origin. In a browser without `Sec-Fetch-Site`, a page on another port could then send a forged `X-Forwarded-Host`. K1 turns Vite's CORS off and accepts `X-Forwarded-Host` only for an `https` Origin.
- **The proxies read paths in two ways (K1).** Most match the raw `req.url`, and the OpenRouter proxy reads `new URL(req.url).pathname`, which resolves `.` and `..`. The guard checks both forms.
- **`whoami -f json` has three shapes (K2).** Signed in: `{"accountType":"IamIdentityCenter",…,"email":…}` on the first line, then text. With `KIRO_API_KEY`: `{"accountType":"ApiKey","email":null}`. Signed out: `{"account":null}` and exit code 1. The app reads only the first JSON line.
- **Kiro can be the default provider before it has models (K2).** The radio button is on when Kiro CLI is signed in. A default provider with no models is safe: new chats use the last model that you picked (`pickDefaultModel`). K5 adds the models.
- **README waits for the chat (K2).** The "Connect a provider" table gets Kiro in K5, when chat works. K2 adds a short "Kiro" part that says what works now.
- **Rules for the Kiro routes.** No `GET` under `/api/kiro` may change state, because older browsers send a cross-site `GET` without the headers that the guard checks. `GET /api/kiro/status` only reads. Sign-in, chat, approvals, and sign-out are `POST` with JSON. A WebSocket route would need its own `Origin` check, so the plan uses SSE only.

## What kiro-cli 3 does

All facts are from probes of kiro-cli 3.5.0 and 3.4.0 on Linux on 2026-11-24, and from KiroBoo, an earlier ACP client for kiro-cli (tested on 3.1.0).

**Install and version**

- The installer puts `kiro-cli` in `~/.local/bin`. On some computers this is a wrapper script that starts the real binary from a different folder.
- `kiro-cli --version` prints `kiro-cli 3.5.0` in 23 ms, also through the wrapper.
- `kiro-cli acp --agent-engine v3 --auth-method cli` starts the v3 engine. Without `--auth-method cli`, `session/new` can wait forever on a token request to the client (KiroBoo).

**Login**

- `kiro-cli whoami -f json` takes 410 ms. Signed in, it prints `{"accountType":"IamIdentityCenter","startUrl":…,"region":…,"email":…}`. Signed out, it prints `Not logged in` and exits 0.
- Signed out, ACP `initialize` returns `authMethods: [{id: "kiro-login"}]` and `loadSession: false`. `session/new` fails with `-32000 "Authentication required…"`. The message also names `KIRO_API_KEY` as a second way to sign in.
- `kiro-cli login` with no terminal and no browser fails: "Failed to open browser for authentication".
- `kiro-cli login --use-device-flow` prints `Code: PDLN-VWLX` and `Open this URL: https://view.awsapps.com/start/#/device?user_code=PDLN-VWLX`, then waits until the user approves. With `--license pro --identity-provider <start URL> --region <Region>`, the URL is on the given start URL. `kiro-cli acp --login` does the same.

**Sessions and models**

- `initialize` takes 1.1 s, `session/new` 0.7 to 0.95 s, `session/load` with `_meta.kiro.noReplay: true` 329 ms, `session/delete` 66 to 202 ms. `session/delete` removes the folder on disk.
- `session/new` returns `configOptions`: `mode` (agents), `model`, `effortLevel`, `autopilot`, and others. 3.4.0 has no `effortLevel`. Send only the options and values that the session lists, and read the result back: Kiro accepts unknown values without an error (KiroBoo).
- The model list has 24 entries for the test account. Each `name` is the same as the id (`claude-opus-5.5`, `gpt-5.6-sol`, `grok-4.7`, `kimi-k3`, `qwen3-coder-next`, `auto`). Some descriptions give the model name ("Claude Opus 5.5 model with 1M context window"), others do not ("Experimental preview of xAI Grok 4.7"). `_meta.kiro` gives `rateMultiplier` (0.01 to 6 credits), `effortLevels`, `defaultEffortLevel`, and `thinkingToggleable`.
- `autopilot` is `on` for every new session. When it is `off`, a shell command sends `session/request_permission` with four options: `allow_once`, `allow_always`, `reject_once`, `reject_always`. The answer is `{outcome: {outcome: "selected", optionId}}`.

**One reply**

| Kiro sends | Content |
|---|---|
| `agent_message_chunk` | Text of the answer |
| `agent_thought_chunk` | Thinking text. None came in 3 probe turns. |
| `tool_call`, `tool_call_update` | `toolCallId`, `title` ("Create hello.txt and verify its contents"), `kind` (`execute`, `read`, `edit`…), `rawInput`, then `status` `completed` or `failed` and `rawOutput` |
| `session_info_update` `focus_update` | A short title for the chat ("Pong Response") |
| `session_info_update` `context_usage` | `usagePercentage`, for example 4.49 |
| `session_info_update` `turn_completion` | Credits of the turn (0.052 for a one-word reply, 0.63 with one tool) and `elapsedTime` in ms |
| `session/prompt` result | `stopReason`: `end_turn`, `cancelled`, `max_tokens`, `max_turn_requests`, or `refusal` |

Kiro also sends many `_kiro/*` notifications (MCP status, memory sync, agent errors). The app ignores them.

**Sessions on disk**

- `~/.kiro/sessions/<bucket>/sess_<uuid>/` holds `session.json` and `messages.jsonl`. The bucket is the first 16 hex characters of the SHA-256 of the session folder path.
- `session.json` has `title`, `workspacePaths`, `createdAt`, `lastModifiedAt`, `modelId`, `agentMode`, `status`.
- `messages.jsonl` has one row per line: `user`, `assistant`, `tool_call`, `tool_result`, `turn_end`, and rows that the app does not need.
- On the test computer: 2,138 sessions. 750 changed in the last 7 days, and only 65 of them have messages. The other 685 are empty "New Session" folders. A scan of the 7 days takes 181 ms. The largest transcript in the window is 9.6 MB.
- `session/list` returns 2,134 sessions in 3.3 s and needs a running Kiro process. Reading the disk is faster.
- v3 has no session lock. Two processes can write the same session (KiroBoo).
- `kiro-cli --resume-picker` groups by date ("Last month", "Older"), shows ID, name, workspace, messages, last used, and status, and starts with "current workspace only".

**Account**

- `_kiro/account/getUsage` returns the plan, credits used, the limit, overage, and the reset date in 432 ms.

## How Kiro fits the app

### Server

New code in `server/kiro/`, registered in `vite.config.ts` like the other proxies.

| File | Job |
|---|---|
| `binary.ts` | Find `kiro-cli` (D1), read the version, check for 3.x (D2) |
| `auth.ts` | `whoami`, the device-flow sign-in, sign-out |
| `acp-client.ts` | JSON-RPC over a child process: requests with timeouts, notifications, answers to Kiro's requests, stop with a kill of the process group |
| `agent.ts` | The shared Kiro process (D5): start on demand, stop when idle or when Vite stops, restart after a crash, live sessions, open approvals, cancel |
| `updates.ts` | Map Kiro updates to the app's SSE events. Pure functions, tested with recorded probe messages |
| `models.ts` | The model list: one short session, read `configOptions`, delete the session, keep the list 10 minutes |
| `sessions.ts` | The index of sessions on disk and the transcript reader |
| `../kiro-proxy.ts` | The routes |

Routes:

| Route | Job | PR |
|---|---|---|
| `GET /api/kiro/status` | Installed, path, version, supported, signed in, account | K2 |
| `POST /api/kiro/login` | Start sign-in. SSE: code and URL, then done or error | K3 |
| `POST /api/kiro/login/cancel`, `POST /api/kiro/logout` | Stop sign-in, sign out | K3 |
| `GET /api/kiro/models` | Model list with levels and credit rate | K5 |
| `POST /api/kiro/chat` | One reply, as SSE | K5 |
| `POST /api/kiro/permission` | The answer to an approval | K6 |
| `GET /api/kiro/sessions?days=7` | Sessions on disk | K7 |
| `GET /api/kiro/sessions/:id/transcript?after=` | Messages of one session, or the rows after a row id | K7 |
| `GET /api/kiro/usage` | Account credits | K8 |

### SSE events

The chat route sends the existing events, and four new ones. `useBedrockChat.ts` ignores unknown keys today, so other providers do not change.

| Kiro | App SSE event |
|---|---|
| `session/new` result | `{session: {id, cwd}}`, first, new |
| `agent_message_chunk` | `{content}` |
| `agent_thought_chunk` | `{reasoning}` |
| `tool_call` | `{toolCall: {id, name: title, args: rawInput}}` |
| `tool_call_update` `completed` / `failed` | `{toolResult: {id, name, result}}` / `{toolResult: {id, name, error}}` |
| `session/request_permission` | `{permission: {requestId, toolCallId, title, options}}`, new (K6) |
| `focus_update` | `{title}`, new |
| `context_usage`, `turn_completion` | `{metadata: {credits, contextPercent, latencyMs}}`, new fields |
| `stopReason` other than `end_turn` | Notice text, as `noAnswerNotice` does today |

### Browser

- `kiro` joins the `Provider` type. The compile-time maps (`PROVIDER_NAMES`, `servicesByProvider`) and the manual lists (`providerOptions.ts`, `providerHelp.ts`, `provider-logos.ts`) get an entry. The logo is a local file in `public/`, because the CSP allows only the app and models.dev.
- `useBedrockChat.ts` gets an explicit Kiro branch. Today an unknown provider goes to Bedrock (`useBedrockChat.ts:292`).
- `src/utils/kiroModels.ts` (no DOM or Node imports) makes short names from model ids: `claude-opus-5.5` → "Claude Opus 5.5", `gpt-5.6-sol` → "GPT 5.6 Sol", `kimi-k3` → "Kimi K3", `minimax-m2.5` → "MiniMax M2.5", `auto` → "Auto". It also maps the Thinking levels (D8).

### Data

- `Conversation` gets `kiro?: { sessionId, cwd, seenSequence, lastRowId? }`. `seenSequence` is the last message that Kiro has seen (D12). `lastRowId` is the last disk row that the app imported (K7).
- Dexie version 3 adds an index on `kiro.sessionId`, so K7 can find a session that is already imported. The other tables do not change.
- `MessageUsage` gets `credits` and `contextPercent`.

### What does not apply to Kiro

Kiro runs its own tools and its own MCP servers. For a Kiro model, the chat input hides web search, MCP tools, and the inference settings (max tokens, max tool steps). The server ignores these fields. Attachments stay Bedrock only in this plan.

## Items

### 1. Block cross-site requests to the API

- **Problem:** A web page on another site can send a POST to `http://localhost:5173/api/...` from your browser. It can start a chat that uses your AWS credentials or API keys, or start an MCP server command through `mcpServers`. With Kiro, it could start an agent that runs shell commands.
- **Evidence:**
  - `server/security.ts:23` to `:37`: `setCORSHeaders` only sets a response header. It does not reject a request.
  - The proxies read the body as JSON and do not check `Content-Type` (for example `server/bedrock-aisdk-proxy.ts:210` for `mcp-status` and `:232` for `chat`). A cross-site `fetch` with `text/plain` is a "simple" request, so the browser sends it with no preflight.
- **Change:** One guard in `server/security.ts` for every `/api` route, as the first Vite plugin, so it runs before the provider proxies and before `server.proxy` (SEC-13 in `docs/SECURITY-LEARNINGS.md`):
  - `Sec-Fetch-Site`, when present, must be `same-origin` or `none`. Otherwise 403.
  - Without `Sec-Fetch-Site`, an `Origin` must name the host of the request: `Host`, or for an `https` Origin `X-Forwarded-Host` (the tunnel). Otherwise 403.
  - The path counts in two forms: the raw URL and the path after `new URL()`, so `/./api/x` and `http://host/api/x` are checked too.
  - Vite's own CORS is off (`server.cors: false`). It answered preflights from other `localhost` ports before the guard ran.
  - `POST`, `PUT`, `PATCH`, and `DELETE` must be `application/json`. Otherwise 415.
  - Requests with neither header (curl, scripts) pass the first two rules.
- **Tunnel:** a probe through `tunnel create` showed that the local server gets `Host: localhost:<port>`, the public host in `X-Forwarded-Host` (the tunnel replaces a value that the client sends), and `Origin` and `Sec-Fetch-Site` unchanged. The tunnel itself blocks cross-site form posts (`text/plain`, form encoded), but not cross-site JSON posts. So the app needs its own check, and a check of `Origin` against `Host` alone would block the app through the tunnel.
- **Tests:** Unit tests for the rules. A real Vite dev server and preview server in a child process, which check that a cross-site post never reaches a plugin route or the `server.proxy` target. A check through the tunnel that the app still works.

### 2. Find kiro-cli

- **Change:**
  - `GET /api/kiro/status` finds the binary (D1), runs `--version` and `whoami -f json`, and keeps the result 30 s.
  - The app reads the status at launch. When `kiro-cli` is not installed, Kiro shows nowhere: not in Preferences and not in the model picker.
  - When it is installed, **Preferences → Providers** shows a Kiro row with one of these states:
    - kiro-cli 2: "Kiro CLI 2 is not supported. Update to Kiro CLI 3 with `kiro-cli update`."
    - Signed out: "Not signed in. Run `kiro-cli login` in a terminal." (K3 replaces this with a button.)
    - Signed in: "Signed in as you@example.com".
  - Kiro cannot be the default provider while it is signed out. Today `isProviderConfigured` is true for every provider with no key (`preferences.ts:101`).
- **Tests:** Fake `kiro-cli` scripts for: not found, 2.x, 3.x signed out, 3.x signed in.

### 3. Sign in from the app

- **Change:**
  - **Sign in** in the Kiro row, and a selection of Kiro as the default provider while signed out, start the sign-in.
  - The row asks for the method (D4) and starts `kiro-cli login --use-device-flow` (D3). For Identity Center it sends the start URL and the Region, and keeps them for the next time.
  - The server reads the code and the URL from the output. It sends the URL to the browser only when it is `https` on `*.awsapps.com` or on the given start URL. It does not log the code.
  - The app opens the sign-in page in a new tab and shows the code in the row, so the user can compare it. If the browser blocks the tab, the row shows an **Open sign-in page** link.
  - When `kiro-cli login` exits with 0, the app reads the status again and shows "Signed in as …". Then it loads the models.
  - **Cancel** stops the sign-in. After 10 minutes the sign-in stops by itself with "Sign-in timed out".
  - **Sign out** runs `kiro-cli logout`.
- **Tests:** A fake `kiro-cli login` that prints a code and exits. A real check with `HOME` set to an empty folder: the code and URL show, and **Cancel** stops the process. The full sign-in needs a person to approve it.

### 4. ACP client and the shared Kiro process

- **Change:** `acp-client.ts` and `agent.ts`, server only, no routes yet.
  - Start: `kiro-cli acp --agent-engine v3 --auth-method cli` as a process group (`detached`), `initialize`, and a check that the engine is v3.
  - Timeouts: `initialize` 30 s, `session/new` 30 s with one retry on a new process, `session/load` 120 s. `session/prompt` has no timeout.
  - Kiro's own requests: `session/request_permission` goes to the approval handler. Every other request gets error `-32601` at once, so nothing waits.
  - Cancel: `session/cancel`, then wait up to 30 s for the `stopReason`, then stop the process.
  - Stop: close stdin, after 1 s `SIGTERM` to the group, after 5 s `SIGKILL`. Also when Vite stops. The exit code 1 after a stdin close is normal (KiroBoo).
  - A session that is not live (after a restart, or from disk) opens with `session/load` and `noReplay`, then gets the same option settings again.
  - Each new or loaded session gets `autopilot` set from D7, and the result is read back.
- **Tests:** A fake ACP process (`server/__tests__/fixtures/fake-kiro-acp.mjs`) that replays recorded 3.5.0 messages. Cases: two chats at the same time, cancel, a crash during a reply, idle stop, no processes left after stop (`ps`).

### 5. Chat with Kiro

- **Change:**
  - The model picker shows a **Kiro** group with the short names, in Kiro's order. The tooltip shows Kiro's description and the credit rate ("2× credits").
  - A new chat opens a Kiro session in the app folder (D6) with the default agent (D9). The first SSE event gives the session id, and the app stores it on the conversation.
  - Each prompt sends only the new message, and before it the messages that Kiro has not seen (D12).
  - The model and the Thinking level are set on the session before each prompt, only when they changed. A model change resets Kiro's level, so the app sets the level again after it.
  - The Thinking button shows for models with `effortLevels` (D8).
  - Thinking, tool calls, and failed tools show in the work row, as for the other providers. "Starting Kiro…" shows while the process starts (about 2 s the first time).
  - Under each reply: credits and time, for example `0.05 credits · 2.9 s`. The context ring uses Kiro's percentage.
  - When the chat still has its automatic title, Kiro's short title replaces it.
  - **Stop** cancels the turn. Kiro keeps running a tool call that has already started, so the app does not say that it did not happen.
  - Until K6 merges, the app answers every approval request with **Deny** (D7), and the work row says "Denied: approvals come in a later version".
  - **Regenerate** and edit are hidden on Kiro replies (D12). **Delete** follows D13.
- **Tests:** Hook tests with SSE fixtures. A real reply with kiro-cli 3.5.0 in headless Chromium, light and dark mode, 1440, 1024, and 390 px, and a reload: the chat looks the same after the reload, and the next message continues the same Kiro session.

### 6. Tool approvals

- **Change:**
  - A request shows in the work row, open, with the tool title and its command or path: "Kiro wants to run `echo hi > hello.txt`". Under it are Kiro's options: **Allow**, **Always allow**, **Deny**, **Always deny**.
  - A click sends `POST /api/kiro/permission`. The step then shows "Allowed" or "Denied".
  - When the reply stream closes or the user clicks **Stop**, the server answers `cancelled`, so Kiro does not wait.
  - Kiro can ask twice for a file write: for the tool, and then to review the changes. Both use the same row.
  - **Preferences → Providers → Kiro** gets **Tool approvals**: Ask (default) or Autopilot (D7).
- **Tests:** The fake process asks for approval. Allow, deny, and a closed stream. A real shell command with kiro-cli.

### 7. Kiro sessions in the sidebar

- **Change:**
  - After sign-in, the Kiro row asks the question from D11. The switch **Show Kiro sessions in the sidebar** keeps the answer.
  - `GET /api/kiro/sessions?days=7` scans the disk. It skips empty sessions, workflow steps, cloud sessions, and unknown formats. A blank or "New Session" title uses the start of the first prompt.
  - The **Kiro sessions** section shows under **Conversations** (D10). It uses the date groups and row style of PR 7 (Today, Yesterday, Previous 7 days), with the folder name of the session on each row. A menu in the header changes the window: Last 7 days (default), Last 30 days, All. **Search chats** filters both sections.
  - A click on a session reads its transcript, makes a conversation with the messages and the tool calls (in the compact form of `toolResults.ts`), and opens it. The next prompt continues the Kiro session in its own folder.
  - Each later open reads the rows after `lastRowId`, so turns that you made in the terminal show too.
  - Kiro has no session lock. When a session shows "in progress" and changed in the last 2 minutes, the chat input says "This session is open in another Kiro window" and does not send.
  - The list refreshes when the window gets focus, and each 60 s.
- **Tests:** A fixture folder with sessions of each kind. The largest real transcript (9.6 MB): import time and the size in IndexedDB. A session continued in the terminal, then opened again.

### 8. Kiro credits

- **Change:**
  - The Kiro row in Preferences shows the plan and the credits of the account: "Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec".
  - The context popover of a Kiro chat shows the credits of this chat and of the account.
  - The values come from `_kiro/account/getUsage`, and the app keeps them 5 minutes.
- **Tests:** Unit tests for the formatting, a real call.

## Found during the planning

- **Cross-site POSTs reach the proxies (item 1).** This is true today for all providers, not only Kiro. K1 fixes it first, because Kiro makes the risk larger.
- **No Thinking text seen.** Three probe turns with Claude Haiku 5.5 and Claude Sonnet 5.5 sent no `agent_thought_chunk`. The work row can show only the tools for Kiro. K5 checks a model with thinking on.
- **3.4.0 has no `effortLevel` option.** The Thinking button must depend on the session's options, not only on the model list.
- **Most session folders are empty.** 685 of 750 sessions of the last 7 days have no messages. Many come from other tools that use Kiro. The app makes one short session for the model list, so it deletes it at once and keeps the list 10 minutes. Otherwise it would add one more empty folder each time.
- **Sign-in with `KIRO_API_KEY`.** Kiro also accepts an API key in the environment. K2 checks how `whoami` reports it. If it does not, the status uses `initialize` instead.

## Delivery plan

| PR | Branch | Items | Waits on |
|---|---|---|---|
| K1 | `fix/api-same-origin` | 1, and this document | Nothing |
| K2 | `feat/kiro-detect` | 2 | K1 |
| K3 | `feat/kiro-sign-in` | 3 | K2 |
| K4 | `feat/kiro-acp-client` | 4 | K2 |
| K5 | `feat/kiro-chat` | 5 | K3, K4 |
| K6 | `feat/kiro-approvals` | 6 | K5 |
| K7 | `feat/kiro-sessions` | 7 | K5 |
| K8 | `feat/kiro-credits` | 8 | K5 |

Merge order: K1, K2, K3, K4, K5, K6, K7, K8. Plan 2 (PRs 6 to 9) is merged in v1.2.0, so no PR waits on it. K3 and K4 can be built at the same time after K2. K6, K7, and K8 can be built at the same time after K5.

Each PR updates `README.md` and `docs/CHANGELOG.md` where the behaviour changes:

- K2: Kiro in the provider table and a "Kiro" part under "Connect a provider".
- K3: the sign-in steps.
- K5: chat with Kiro, what the chat input hides, credits under each reply, and `/api/kiro` in the route table.
- K6: tool approvals.
- K7: "Kiro sessions" under "Find a chat".
- K8: account credits.

K2 also updates `.kiro/steering/CLAUDE.md` (provider and proxy tables) and `docs/SECURITY.md` (how the app starts Kiro and what it sends).

Each PR is tested as the UI guidelines say. Before each push, the app runs in the background with `hc` and a tunnel, so you can test it from your desktop.

## Not in this plan

- A folder chip per chat (D6 (b)) and an agent picker (D9 (b) and (c)).
- Images and files for Kiro. Kiro accepts images and embedded text (`promptCapabilities`), but the app's attachments are Bedrock only today.
- Regenerate with `session/fork`. Kiro can fork a session at a message, so regenerate can come back later.
- Diffs for file edits in the work row ("coding steps" in `docs/UIUX-IMPROVEMENTS.md`).
- Kiro's slash commands, plans, and spec mode.
- Windows. kiro-cli runs on macOS and Linux.
