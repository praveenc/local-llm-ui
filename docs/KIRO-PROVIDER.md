# Kiro provider

Status: approved, in progress. All decisions take the recommended option (2026-11-24). On 2026-11-25 the direction became: Kiro is the provider and kiro-cli is the harness (D15 to D20). See [Progress](#progress) for the state of each PR. Last updated 2026-11-25.

This document plans Kiro as a provider. Kiro is not an HTTP API. It is a local agent (`kiro-cli`) that the app starts as a child process and talks to with the Agent Client Protocol (ACP): JSON-RPC, one message per line, on stdin and stdout. Kiro keeps its own login, model list, sessions on disk, tools, and credits. The app must fit these into its existing patterns: one model picker, one chat view, one work row, one SSE format.

The plan supports kiro-cli 3 only. kiro-cli 2 gets a clear message and no Kiro features.

The direction since 2026-11-25: the app signs in with Kiro and then gives the work to kiro-cli over ACP. It does not rebuild what kiro-cli has: its session management, its permissions, and its resume. It reads these values from Kiro and shows them in the UI. The ACP layer is generic, so another harness (for example Pi or Claude) can plug in later. Kiro is the first harness.

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
| D7 | Does Kiro ask before it runs a tool? | Approved: (a). Ask by default. The work row shows the request with Allow, Always allow, and Deny. Preferences can change it to Autopilot. Until K6 merges, K5 denies every request, so no tool runs without a question. Changed by D16 and D17. | K5, K6 |
| D8 | How does the Thinking menu map to Kiro? | Approved: (a). Add **Max** to the menu, shown only for models that have it. Other levels map to the nearest level of the model, as today. **Off** turns thinking off, or sends `none`, or the lowest level. | K5 |
| D9 | Which Kiro agent do chats use? | Approved: (a). Kiro's default agent. A **Default agent** select in Preferences is a later item. D17 removes the lock on `mode`, and D20 adds an agent picker. | K5 |
| D10 | Where do Kiro chats show in the sidebar? | Approved: (a). **Conversations** holds every chat that you used in this app, also Kiro chats. A **Kiro sessions** section lists the sessions on disk that you have not opened here yet. When you open one, the app imports it and it moves to **Conversations**. Every chat has one place, and the Kiro section works as an import list. D18 changes how the list and the import work, not what they show. | K7 |
| D11 | When does the app ask about the sessions on disk? | Approved: (a). After sign-in, the Kiro row in Preferences asks "Show your Kiro sessions in the sidebar?" with **Show** and **Not now**. A switch below keeps the choice. | K7 |
| D12 | How do mixed chats, fork, and regenerate work? | Approved: (a). Before each Kiro prompt, the app sends the earlier messages that Kiro has not seen, once, as context. This covers a switch to Kiro in the middle of a chat, **Send to Fork**, and a switch back after another model. **Regenerate** and edit are hidden on Kiro replies. | K5 |
| D13 | What does **Delete** do on a Kiro chat? | Approved: (a). It removes the chat from the app only. Kiro's files stay. | K5, K7 |
| D14 | Own ACP client or the ACP SDK? | Approved: (a). A small own client, about 150 lines, with the message types copied from KiroBoo. | K4 |
| D15 | Who does what: the app or kiro-cli? | Approved: (a). Kiro is the provider and kiro-cli is the harness. The app signs in, then gives the work to kiro-cli over ACP and shows what Kiro reports. The ACP code is generic (`server/acp/`, no Kiro names). The Kiro parts are a harness adapter (`server/kiro/`). Another ACP harness can use the same layer later, for example Pi or Claude. | H1 |
| D16 | How do tool approvals work? | Approved: (a). The work row shows Kiro's own questions, options, and labels: Allow, Always allow, Deny, Always deny, and for "Review changes" Accept changes and Reject changes. Kiro keeps the "always" rules itself. The app has no approval rules and no approval setting of its own. Changes D7: the Autopilot choice moves to the session options of K9. | K6 |
| D17 | Does the app lock `autopilot` and `mode`? | Approved: (a). No. New sessions use Kiro's defaults, as in the terminal: Autopilot is on, reads run without a question, and shell commands and file writes still ask. Changes D7, D9, and SEC-15. | K6 |
| D18 | Where do Kiro sessions come from? | Approved: (a). From Kiro: `session/list` for the list, `session/load` with replay to import a session, `session/close` after each reply so the terminal can resume it, and Kiro's lease error ("loaded in another program") as the chat error. The app does not read `~/.kiro/sessions` for the list or the transcript. Changes how D10 works, not what it shows. | K7 |
| D19 | Which sessions does the list show? | Approved: (a). The list hides sessions that were never used: their title is "New Session", Kiro's name before the first prompt. | K7 |
| D20 | Which session options does the chat input show? | Approved: (a). The options that Kiro lists. `mode` shows as an agent picker. The options without an ACP category (for example Autopilot) show in one menu, with Kiro's names and descriptions. The app picks a control by the ACP category (`mode`, `model`, `thought_level`), so it works for any harness. | K9 |

## Progress

| PR | Branch | Items | State |
|---|---|---|---|
| K1 | `fix/api-same-origin` | 1 | Done, merged ([#76](https://github.com/praveenc/local-llm-ui/pull/76)) |
| K2 | `feat/kiro-detect` | 2 | Done, merged ([#77](https://github.com/praveenc/local-llm-ui/pull/77)) |
| K3 | `feat/kiro-sign-in` | 3 | Done, merged ([#78](https://github.com/praveenc/local-llm-ui/pull/78)) |
| K4 | `feat/kiro-acp-client` | 4 | Done, merged ([#79](https://github.com/praveenc/local-llm-ui/pull/79)) |
| K5 | `feat/kiro-chat` | 5 | Done, merged ([#80](https://github.com/praveenc/local-llm-ui/pull/80)) |
| H1 | `refactor/acp-harness` | D15 | Done, merged ([#81](https://github.com/praveenc/local-llm-ui/pull/81)) |
| K6 | `feat/kiro-approvals` | 6 | Done, merged ([#82](https://github.com/praveenc/local-llm-ui/pull/82)) |
| K7 | `feat/kiro-sessions` | 7 | In review ([#83](https://github.com/praveenc/local-llm-ui/pull/83)) |
| K8 | `feat/kiro-credits` | 8 | Planned |
| K9 | `feat/kiro-session-options` | 9 | Planned |

### Found during the work

- **Vite's CORS answered preflights from other ports (K1).** Vite's default CORS middleware runs before every plugin and allows any `localhost` origin. In a browser without `Sec-Fetch-Site`, a page on another port could then send a forged `X-Forwarded-Host`. K1 turns Vite's CORS off and accepts `X-Forwarded-Host` only for an `https` Origin.
- **The proxies read paths in two ways (K1).** Most match the raw `req.url`, and the OpenRouter proxy reads `new URL(req.url).pathname`, which resolves `.` and `..`. The guard checks both forms.
- **`whoami -f json` has three shapes (K2).** Signed in: `{"accountType":"IamIdentityCenter",…,"email":…}` on the first line, then text. With `KIRO_API_KEY`: `{"accountType":"ApiKey","email":null}`. Signed out: `{"account":null}` and exit code 1. The app reads only the first JSON line.
- **Kiro can be the default provider before it has models (K2).** The radio button is on when Kiro CLI is signed in. A default provider with no models is safe: new chats use the last model that you picked (`pickDefaultModel`). K5 adds the models.
- **README waits for the chat (K2).** The "Connect a provider" table gets Kiro in K5, when chat works. K2 adds a short "Kiro" part that says what works now.
- **Device-flow output (K3).** `kiro-cli login --use-device-flow` prints `Code: XXXX-XXXX` and `Open this URL: https://view.awsapps.com/start/#/device?user_code=…` on stdout, also through a wrapper script, then waits. A bad start URL prints `error: InvalidRequestException` and exits 1; the app says "The start URL or the Region is not correct". `kiro-cli logout` exits 0 also when you are signed out already.
- **The new tab opens on the click (K3).** Browsers block a tab that a page opens after a `fetch`. The app opens an empty tab when you click **Continue**, and sends it to the sign-in page when the code comes. If the browser blocks the tab, the row shows an **Open sign-in page** link.
- **Kiro as the default before sign-in (K3).** The Kiro radio button is on while Kiro CLI is signed out. A click opens the sign-in form and does not save the default. Kiro becomes the default only when a sign-in that the app started is complete. A sign-in in a terminal followed by **Check again**, a failed sign-in, a closed dialog without a running sign-in, and a click on a different provider all cancel the wish.
- **Ctrl+C did not stop Kiro processes (K3, K4 review).** Node does not run its `exit` listeners when `SIGINT` or `SIGHUP` ends it, and Vite handles only `SIGTERM`. The Kiro processes run in their own process groups, so they do not get the terminal's signal. `server/acp/process-end.ts` (moved from `server/kiro/` in H1) runs the cleanups on these signals too, then sends the signal again.
- **Tunnels close idle connections (K3 review).** The sign-in stream sends `: ping` every 15 s while it waits for the approval.
- **Sign-out signs out everywhere (K3).** `kiro-cli logout` signs out every Kiro CLI on the computer, also in terminals. The app asks before it signs out.
- **The engine has its own process groups (K4).** The v3 engine runs in a process group of its own, and a wrapper script adds one more. One `kiro-cli acp` starts 20 to 26 processes, the user's MCP servers, which is another reason for one shared process (D5). A stop reads all descendant groups with `ps` before it closes stdin, then sends `SIGTERM` and `SIGKILL` to each group. With kiro-cli 3.6.0, nothing was left 1.5 s after a stop. Exit code 143 after `SIGTERM` is normal.
- **Autopilot stays off (K4 review).** The app checks Autopilot after every option change and every `config_option_update`. If Kiro turns it on, the app cancels the reply of that session, turns Autopilot off again, and uses the session only after it reads `off` back. The app does not change `mode` (the agent) or `autopilot` itself: an agent can have its own allow rules that run tools without a question (KiroBoo found this), so D9 keeps Kiro's default agent. K6 removes this lock (D17).
- **A failed load must not delete (K4 review).** When a session from disk fails the Autopilot check, the app stops using it but keeps it on disk. Only a session that the app made in that call is deleted.
- **After a crash, stop the recorded groups (K4 review).** Once `kiro-cli acp` is dead, `ps` cannot find its children. The app records the process groups while the process runs and stops them after a crash.
- **No engine check (K4).** The `initialize` result has no field that names the engine. The app starts `--agent-engine v3`, and K2 already refuses Kiro CLI 2, so K4 does not check it again.
- **Real check of K4 (before the review fixes).** With kiro-cli 3.6.0: two sessions on one process in 4.0 s, Autopilot off and read back on both, two replies at the same time, a shell command denied by default (its file was not made), a cancel in 2.6 s, and a stop in 1.5 s with no process left.
- **The model list starts Kiro (K5).** Kiro lists its models only in the options of a session. The server makes a session, reads the list, and deletes the session. One start of `kiro-cli acp` also starts the user's MCP servers, so the server keeps the list for 1 hour, and each chat session that opens makes it fresh again. The route is a `POST`, because it changes state. The app does not wait for Kiro's models before it restores a model of another provider.
- **Kiro sends no tokens (K5).** Kiro reports credits per reply (`turn_completion`) and a context percentage (`context_usage`). `MessageUsage` gets `credits` and `contextPercent`. Under a Kiro reply the app shows `0.05 credits · 2.9 s`, and the context ring uses Kiro's percentage.
- **The session event marks what Kiro has seen (K5).** The server sends `{ session }` right before Kiro gets the message. The browser counts the message as seen only after that event, and a reply without text does not count as a message. When the chat has fewer messages than Kiro saw (a regenerate or a delete), the server starts a new session with the whole chat as context. A session that the request made and did not use is deleted.
- **One reply at a time in a session (K5 review).** A new message right after **Stop** waits until Kiro has ended the cancelled reply, and only then changes the model or the effort.
- **Regenerate kept the user message twice (found in K5).** Regenerate deleted the reply but kept the user row, and then added the user message again. Regenerate now deletes from the user message, as **Retry** does. This was a bug for all providers.
- **Titles that the user changed (K5).** A conversation gets `titleEdited` when you rename it. Kiro's title replaces only a title that is still the automatic title of the first message, so chats renamed before this version keep their names.
- **Errors without paths (K5 review).** The browser gets plain error text. Details, for example a folder path, go to the terminal that runs `npm run dev`.
- **Kiro asks for some tools only (K5).** Kiro's default agent runs some tools, for example reads, without a question. The app denies every question that Kiro asks until K6.
- **Autopilot on does not remove tool questions (probe, 2026-11-25).** Shell commands and file writes still ask. Autopilot removes only the "Review changes" step. Reads do not ask.
- **A file write asks twice (probe, 2026-11-25).** First the write, then "Review changes" with its own made-up tool call id and two options. `_meta.kiro.files[].toolCallId` names the write.
- **"Always" holds for the session only (probe, 2026-11-25).** "Always allow" and "Always deny" live in Kiro's memory and match the start of the command (`echo hi` covers `echo hi > other.txt`). Kiro writes no file for them. A new session asks again.
- **Cancel drops an open question (probe, 2026-11-25).** On `session/cancel` Kiro ends the turn in about 160 ms and drops the open question. A later answer is ignored. A `cancelled` answer counts as one Deny.
- **One question at a time (probe, 2026-11-25).** Kiro asks one permission question at a time in a session.
- **`session/list` returns everything (probe, 2026-11-25).** About 2,300 sessions in about 2.4 s, each with id, folder, title, last change, and status. It filters only by `cwd` and has no paging. 13 MB of the 14 MB result are agent prompts in `_meta.kiro.customAgents`. Most sessions were never used.
- **`_kiro/sessions/changed` is local (probe, 2026-11-25).** It reports new, changed, and deleted sessions, but only for sessions in the same `kiro-cli acp` process. It does not report a session that you change in a terminal.
- **`session/load` replays the session (probe, 2026-11-25).** Without `noReplay`, Kiro sends the session as `session/update` messages with `replay: true`, before the load answer: user text, thinking, tool calls with status and output, credits, and context %. The title is in the load answer. A 22 MB session replays in 2.3 s, and no file on disk changes.
- **Kiro has a session lease (probe, 2026-11-25).** A second program can load a session, but a prompt fails with "This session is loaded in another program". `session/close` releases the lease and keeps the files. This replaces the "no session lock" that KiroBoo found in 3.1.0.
- **Usage needs no session (probe, 2026-11-25).** `_kiro/account/getUsage` answers in about 300 ms. The reset date is a `YYYY-MM-DD` string. The percentage can go above 100.
- **No agent version (probe, 2026-11-25).** In 3.6.0 the `initialize` answer has no agent version.
- **The ACP layer runs without Kiro (H1).** It runs with a small non-Kiro test agent. A test fails if a file in `server/acp/` names Kiro or imports from outside the folder.
- **Rules for the Kiro routes.** No `GET` under `/api/kiro` may change state, because older browsers send a cross-site `GET` without the headers that the guard checks. `GET /api/kiro/status` only reads. Sign-in, chat, approvals, and sign-out are `POST` with JSON. A WebSocket route would need its own `Origin` check, so the plan uses SSE only.
- **The question has its own id (K6).** The server makes a random `requestId` for each question, so the browser never sees Kiro's JSON-RPC id. The registry accepts one answer and only an option that the question lists, then forgets the question. A second answer gets 404.
- **A denied tool is not a failed tool (K6).** Kiro ends a rejected tool as `failed` with its own text. The row reads the last approval of the tool call: a reject option gives **Denied**, and a question that ended with no answer gives **Not answered**. Neither counts as a failure. A rejected "Review changes" counts as denied in the summary.
- **A question can come before its tool call (K6).** The row of a question with no known tool call is made at once, and the later tool call keeps its approvals. "Review changes" has a made-up tool call id, so it goes to the write that `files[].toolCallId` names.
- **Idle streams (K6).** A question can wait 10 minutes with no data on the stream. The chat route sends `: ping` every 15 s while a question is open, as the sign-in route does.
- **Real check of K6 (kiro-cli 3.6.1, Claude Haiku 5.5, 2026-11-25).** The question showed after about 8 s with Kiro's four options. **Allow** made the file, and **Deny** did not. **Always allow** gave no second question for the same command. A write with Autopilot on asked once, with no "Review changes". **Stop** ended the open question and the next message worked. A read asked nothing. The two-question path is not reachable in the browser with Autopilot on, so a fake-process test covers it. K9 can check it with Autopilot off.
- **An "Always" rule is narrow (K6).** After **Always allow** for one `echo` command, a later `echo` command with another start asked again. The rule is Kiro's. The app shows the question as Kiro sends it.
- **A stopped reply is not saved (found in K6).** The app does not store a reply that **Stop** ended, so a reload does not show its **Not answered** row. The stored form is covered by unit tests. This was the case before K6.
- **Small points left (K6).** The question line shows the command between backticks as plain text, and the line shows once in the row summary and once under the tool line. At 390 px the tool line cuts the command, and the question line under it shows the whole command.
- **The list and the import come from Kiro (K7).** The server reads `session/list` and keeps only the id, folder, title, last change, and status of each session. `_meta.kiro.customAgents` is 13 MB of 14 MB, and the server drops it at once. `POST /api/kiro/sessions/open` runs `session/load` with replay, collects the replayed updates, and closes the session. The replay of the largest session is 64.6 MB of updates, but the collector keeps only compact turns. The app never reads `~/.kiro/sessions` for the list or the transcript (D18).
- **Real import of the largest session (K7).** The largest idle session had 22 MB on disk, 58 turns, and 3,595 tool calls. The server took 2.6 s, and the chat showed after 3.7 s. The response was 7.9 MB, so the 16 MB limit did not apply. The app stored 116 messages, and the browser storage went from 253 KB to 5.3 MB. The two session files, the file count, and the file times did not change. **Delete** removed the chat from the app only.
- **Kiro lists more than chats (K7).** The list has sessions that Kiro makes for itself (memory consolidation, prompt optimiser) and sessions whose first message is a system prompt. The app hides only "New Session" (D19) and shows the rest as Kiro lists them. In a list of about 2,300 sessions, Last 7 days shows 85 rows and All shows 275 rows.
- **The lease starts at `session/load` (K7, kiro-cli 3.6.1).** The lease file is written when a program loads the session, not at the first prompt. A `session/close` from a program that does not hold the lease does not remove the lease: the app replayed and closed a session that a probe held, and the probe could still prompt. The app closes a session only after a prompt that ended, never after a failed one.
- **A close after each reply costs one load (K7).** After `session/close`, the next message in the chat runs `session/load` without replay. This also picks up turns that the terminal made. Kiro lets you prompt after a close in the same process, but the app does not depend on it.
- **The sync counts turns, not time (K7).** The chat stores `kiro.turns` (the turns that it has) and `kiro.updatedAt`. A later open of a chat whose session Kiro changed asks the open route for the turns after `kiro.turns` and adds them at the end. Clocks of the browser and the server do not matter. If Kiro reports fewer turns than the chat has (for example after Kiro makes the session smaller), the app adds nothing and only stores the new `updatedAt`. A turn that is still running (no `turn_end`) is left out, so the next sync gets it in full.
- **A send waits for a running sync (K7 review).** When you open a chat and send a message at once, the send could read the chat before the sync wrote the new turns. The messages then showed twice. The send now waits for the sync of the same chat ("Adding the new Kiro turns…"). A test with a slow open route checked the result: no duplicates and the right turn count.
- **Sync limits (K7).** A chat syncs only when its session is in the list that the browser holds now. The list covers the window of the menu (Last 7 days by default), so an older session needs **All**. A chat that was made before K7 has no turn count and never syncs. After a reply in the app, Kiro's `updatedAt` is newer than the stored one, so the next open runs one replay that adds nothing (about 0.2 s for a small session, about 2.6 s for the largest).
- **A stopped reply can count one turn less (K7 review).** If Kiro sends no `turn_end` for a reply that you stopped, the replay counts one turn less than the app stored. The sync then adds nothing, which is safe. The next terminal turn makes the counts agree again.
- **Polling keeps Kiro CLI running (K7).** Each list call restarts the 10-minute idle time of Kiro CLI. The browser refreshes only while the page is visible and the section is on, at most once a minute, and the server keeps the list 60 s. Kiro CLI stops 10 minutes after you hide the page or turn the section off.
- **Kiro tells the server when the list changes (K7).** The server drops its list cache on `_kiro/sessions/changed`. Kiro sends it on each app reply, so the cache is new after each reply. It does not report a change from a terminal. A change from a terminal shows after the 60 s cache.

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

These are facts about Kiro's files. The app does not read them (D18).

- `~/.kiro/sessions/<bucket>/sess_<uuid>/` holds `session.json` and `messages.jsonl`. The bucket is the first 16 hex characters of the SHA-256 of the session folder path.
- `session.json` has `title`, `workspacePaths`, `createdAt`, `lastModifiedAt`, `modelId`, `agentMode`, `status`.
- `messages.jsonl` has one row per line: `user`, `assistant`, `tool_call`, `tool_result`, `turn_end`, and rows that the app does not need.
- On the test computer: 2,138 sessions. 750 changed in the last 7 days, and only 65 of them have messages. The other 685 are empty "New Session" folders. A scan of the 7 days takes 181 ms. The largest transcript in the window is 9.6 MB.
- `session/list` returns every session in a few seconds and needs a running Kiro process. Since D18 the app uses it and does not read these files.
- KiroBoo found no session lock in 3.1.0. kiro-cli 3.6.0 has a lease (see [Found during the work](#found-during-the-work)).
- `kiro-cli --resume-picker` groups by date ("Last month", "Older"), shows ID, name, workspace, messages, last used, and status, and starts with "current workspace only".

**Account**

- `_kiro/account/getUsage` returns the plan, credits used, the limit, overage, and the reset date in 432 ms.

## How Kiro fits the app

### Server

The ACP code is in `server/acp/`. It is generic and has no Kiro names (D15). A test fails when a file in this folder names Kiro or imports from outside the folder. The Kiro parts are in `server/kiro/`. Both are registered in `vite.config.ts` through `server/kiro-proxy.ts`, like the other proxies. A new harness adds its own adapter folder next to `server/kiro/`.

`server/acp/`:

| File | Job |
|---|---|
| `client.ts` | JSON-RPC over a child process: requests with timeouts, notifications, answers to the agent's requests |
| `types.ts` | The standard ACP message types that the app uses |
| `process.ts` | Start the agent in its own process group, record the groups, stop the whole tree |
| `process-end.ts` | Run the cleanups when the dev server ends, also on Ctrl+C and a closed terminal |
| `harness.ts` | The adapter interface (types only): how to start the agent, its names, its errors, its `_meta` fields |
| `agent.ts` | The shared agent process (D5): start on demand, stop when idle or when Vite stops, restart after a crash, live sessions, open approvals, cancel |
| `permissions.ts` | Permission types, the choice of an option by kind, the default denial, the answer logic, how a question ends |
| `permission-registry.ts` | The open questions, each under a random request id. It accepts one answer, and only an option that the question lists (K6) |
| `updates.ts` | Map `session/update` messages to the app's SSE events. Pure functions, tested with recorded probe messages |
| `config-options.ts` | Helpers for the config options of a session |

`server/kiro/`:

| File | Job |
|---|---|
| `binary.ts` | Find `kiro-cli` (D1), check the file |
| `run.ts` | Run `kiro-cli` with fixed arguments and a time limit, no shell |
| `status.ts` | `--version` and `whoami`, check for 3.x (D2) |
| `login.ts` | The device-flow sign-in and sign-out |
| `models.ts` | The model list: one short session, read `configOptions`, delete the session, keep the list 1 hour |
| `session-files.ts` | The folder of an existing session, read from its `session.json`. The chat route uses it (SEC-16). The sessions routes use `session/list` instead (K7) |
| `harness.ts` | The Kiro adapter: `kiro-cli acp` arguments, environment, own folder, signed-out rules, names, `_meta.kiro` hooks |
| `errors.ts` | The Kiro error classes |
| `agent.ts` | The Kiro agent: the generic agent with the Kiro harness, the singleton, the extension methods that are allowed |
| `chat.ts` | The `/api/kiro/chat` route |
| `sessions.ts` | The `/api/kiro/sessions` and `/api/kiro/sessions/open` routes: the list with a 60 s cache, and the import with replay (K7) |
| `replay.ts` | Turns the replayed `session/update` messages into compact messages, with the size limits (K7) |
| `lease.ts` | Kiro's own "loaded in another program" text, for the chat error (K7) |
| `reply-meta.ts` | The `_meta.kiro` fields of a reply: title, context, credits, display error |
| `chat-options.ts` | Set the model and the Thinking level on a session |
| `approvals.ts` | Turns a permission question into the SSE event: Kiro's options, the command, the files of a "Review changes" question, and how a question ended (K6) |
| `permission-route.ts` | The `POST /api/kiro/permission` route (K6) |

Routes:

| Route | Job | PR |
|---|---|---|
| `GET /api/kiro/status` | Installed, path, version, supported, signed in, account | K2 |
| `POST /api/kiro/login` | Start sign-in. SSE: code and URL, then done or error | K3 |
| `POST /api/kiro/login/cancel`, `POST /api/kiro/logout` | Stop sign-in, sign out | K3 |
| `POST /api/kiro/models` | Model list with levels and credit rate. A `POST`, because a load can start Kiro CLI and make a session | K5 |
| `POST /api/kiro/chat` | One reply, as SSE | K5 |
| `POST /api/kiro/permission` | The answer to an approval question. It never starts Kiro CLI | K6 |
| `POST /api/kiro/sessions` | The list of Kiro sessions. A `POST`, because the list can start Kiro CLI | K7 |
| `POST /api/kiro/sessions/open` | Import a session with replay, or the turns after a known count. JSON | K7 |
| `POST /api/kiro/usage` | Account credits. A `POST`, because it can start Kiro CLI | K8 |

### SSE events

The chat route sends the existing events, and new ones. `useBedrockChat.ts` ignores unknown keys today, so other providers do not change.

| Kiro | App SSE event |
|---|---|
| `session/new` result | `{session: {id, cwd}}`, first, new |
| `agent_message_chunk` | `{content}` |
| `agent_thought_chunk` | `{reasoning}` |
| `tool_call` | `{toolCall: {id, name: title, args: rawInput}}` |
| `tool_call_update` `completed` / `failed` | `{toolResult: {id, name, result}}` / `{toolResult: {id, name, error}}` |
| `session/request_permission` | `{permission: {requestId, toolCallId, title, options, …}}`, new (K6) |
| A question ends (answer, stop, closed stream, time limit) | `{permissionResult: {requestId, optionId?, kind?, outcome}}`, new (K6) |
| `focus_update` | `{title}`, new |
| `context_usage`, `turn_completion` | `{metadata: {credits, contextPercent, latencyMs}}`, new fields |
| `stopReason` other than `end_turn` | Notice text, as `noAnswerNotice` does today |

### Browser

- `kiro` joins the `Provider` type. The compile-time maps (`PROVIDER_NAMES`, `servicesByProvider`) and the manual lists (`providerOptions.ts`, `providerHelp.ts`, `provider-logos.ts`) get an entry. The logo is a local file in `public/`, because the CSP allows only the app and models.dev.
- `useBedrockChat.ts` gets an explicit Kiro branch. Today an unknown provider goes to Bedrock (`useBedrockChat.ts:292`).
- `src/utils/kiroModels.ts` (no DOM or Node imports) makes short names from model ids: `claude-opus-5.5` → "Claude Opus 5.5", `gpt-5.6-sol` → "GPT 5.6 Sol", `kimi-k3` → "Kimi K3", `minimax-m2.5` → "MiniMax M2.5", `auto` → "Auto". It also maps the Thinking levels (D8).

### Data

- `Conversation.kiro` is `{ sessionId, seenMessages }` today. `seenMessages` is how many messages Kiro has seen (D12). K7 adds `updatedAt` (the Kiro last change of the last import or sync) and `turns` (how many turns of the session the chat holds).
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
  - When `kiro-cli login` exits with 0, the app reads the status again and shows "Signed in as …". K5 loads the models.
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
  - Kiro's default agent runs Autopilot, as in the terminal (D17). Reads run without a question. Shell commands and file writes ask. The app does not lock `autopilot` or `mode`. K6 deletes `server/kiro/autopilot.ts` and removes the guard line in `server/kiro/harness.ts`. The generic `SessionGuard` hook stays, because its tests use it, and no harness sets it.
  - A question shows in the work row, open, with its line, for example "Kiro wants to run" and the command. Under the tool line are Kiro's own options with Kiro's labels and in Kiro's order: **Allow**, **Always allow**, **Deny**, **Always deny** (D16). The buttons are 44 px high.
  - The server makes a random `requestId` for each question and sends `{ permission: … }` on the chat stream. The id is not Kiro's JSON-RPC id. `server/acp/permission-registry.ts` keeps the question with Kiro's options.
  - A click sends `POST /api/kiro/permission` with `{ requestId, optionId }`. The body is JSON and at most 1 KB. The answer is 200, 404 (the question is unknown or has ended), or 400 (the option is not one of the question's options). The buttons stay disabled while the request waits, and an error shows in words.
  - When a question ends, the server sends `{ permissionResult: … }`. The tool line then says the answer from the option kind: **Allowed**, **Always allowed**, **Denied**, **Always denied**, or for "Review changes" **Changes accepted** and **Changes rejected**.
  - A tool that the user denied says **Denied**, not **Failed**, and the summary says "1 denied" in the muted colour. A tool that fails for another reason still says **Failed**.
  - Kiro asks twice for a file write when Autopilot is off: for the write, and then "Review changes" with **Accept changes** and **Reject changes**. The app links the second question to the write with `_meta.kiro.files[].toolCallId`, and both show in the row of the write. A question whose tool call has not arrived yet gets a row of its own, and the later tool call keeps it.
  - Kiro asks one question at a time in a session, so the row shows one open question.
  - Kiro keeps the "always" rules in its own memory for the session. The app stores no rule and has no approval setting of its own.
  - **Stop**, a closed stream, a crash, and the 10-minute limit end every open question. **Stop**, a closed stream, and a crash answer `cancelled`, and Kiro counts this as one Deny. The time limit answers `reject_once`. The row says **Not answered** in each case, because the user chose nothing. No question stays open.
  - While a question is open, the chat stream sends `: ping` every 15 s, so a tunnel does not close the idle connection.
  - The answers are stored with the message in the compact form of `toolResults.ts`. An open question that is stored shows as **Not answered**.
- **Tests:** The fake process asks for approval. Allow, always allow, deny, a "Review changes" question, a closed stream, and Stop. Route tests for 200, 400, 404, 405, 413, and a cross-site request. Work row tests for the open state, the words, "1 denied", the click, and a reload. A real shell command, a real deny, a real always allow, a real file write, Stop with an open question, and a read with kiro-cli 3.6.1 in headless Chromium.

### 7. Kiro sessions in the sidebar

- **Change:**
  - After sign-in, the Kiro row asks the question from D11. The switch **Show Kiro sessions in the sidebar** keeps the answer (`showKiroSessions` in the preferences).
  - `POST /api/kiro/sessions` calls `session/list` on the shared Kiro process (D18). The body is `{ days: 7 | 30 | null }`. The server keeps only the id, folder, title, last change, and status of each session. It drops `_meta.kiro.customAgents` and hides sessions that were never used (D19). `folder` is the last part of the session folder, so the browser gets no full path. The server keeps the parsed list 60 s and drops it when Kiro sends `_kiro/sessions/changed`.
  - The **Kiro sessions** section shows under **Conversations** (D10). It uses the date groups and row style of PR 7, with the folder name on each row, and its own open-state key. A menu in the header changes the window: Last 7 days (default), Last 30 days, All. **Search chats** filters both sections. A session that a conversation already has does not show.
  - The list refreshes when the window gets focus and each minute while the page is visible. The server cache holds 60 s, so a change from a terminal shows within a minute.
  - A click calls `POST /api/kiro/sessions/open` with the session id and `skipTurns`. The id must match `sess_<uuid>` and be in Kiro's own list. The server loads the session with replay in its own folder, maps the replayed updates with the same code as a live reply, and closes the session. The answer is JSON (not SSE): title, last change, model, and compact messages. Each message has the text (without the app's `<conversation_context>` block), the thinking, the tool calls with status and output (cut to 8,000 characters), the credits, the context percentage, and the time. The app leaves out images and says how many. The answer has at most 16 MB of JSON. When it is longer, the oldest turns are left out, and the app says how many.
  - The app makes the conversation and its messages in one Dexie transaction (database version 3, index `kiro.sessionId`), then opens it. A second click on the same session opens the existing conversation.
  - A later open of a chat whose session Kiro changed (the list has a newer `updatedAt`) calls the open route with `skipTurns` set to the turns that the chat holds, and adds the new turns at the end. If the chat also has messages that Kiro has not seen, `seenMessages` stays the same. The next prompt then sends them, and the new turns, once as context. A send waits for a running sync of the same chat.
  - After each reply, the server calls `session/close`, so the terminal can resume the session. It does not close after a failed prompt, because the lease may belong to another program.
  - When another program has loaded the session, Kiro answers the prompt with "This session is loaded in another program". The chat shows this text as the error, with **Retry**. The app has no lock of its own.
  - The app does not read `~/.kiro/sessions` for the list or the transcript. `server/kiro/session-files.ts` only checks the folder of one session for the chat route (SEC-16).
  - Known limits: a chat syncs only when its session is in the list of the current window, a chat made before K7 has no turn count and does not sync, and the reopen after an app reply does one replay that adds nothing. See "Found during the work".
- **Tests:** The fake ACP agent and the fake Kiro answer `session/list` (with a "New Session" entry and a big `customAgents`), replay a session before the load answer, answer `session/close`, and refuse a prompt with the lease error. Server tests for both routes, the replay mapping and its limits, and the close after a reply. Browser tests for the import, the sync, the Dexie version 3 upgrade from version 2 data, the section, and the D11 question. A real list with kiro-cli 3.6.1, a real import of the largest idle session (22 MB), a session that a probe continued, and a session that a probe held.

### 8. Kiro credits

- **Change:**
  - `POST /api/kiro/usage` calls `_kiro/account/getUsage`, which needs no session and answers in about 300 ms. The route is a `POST`, because it can start Kiro CLI. The app keeps the result 5 minutes.
  - The Kiro row in Preferences shows the plan and the credits of the account: "Kiro Power · 1,250 of 10,000 credits used · resets 1 Dec". The reset date is a `YYYY-MM-DD` string.
  - The percentage can go above 100. The app shows the number that Kiro reports and does not cap it.
  - The context popover of a Kiro chat shows the credits of this chat and of the account.
- **Tests:** Unit tests for the formatting, with a percentage above 100. A real call.

### 9. Session options

- **Change:**
  - The chat input shows the session options that Kiro lists, with Kiro's names and descriptions (D20).
  - The option with the category `mode` shows as an agent picker.
  - The options with no ACP category, for example Autopilot, show in one menu.
  - The model and the Thinking level keep their own controls. The app picks each control by the ACP category (`mode`, `model`, `thought_level`), not by a Kiro id, so a different harness works the same way.
  - The chat request gets an `options` field. The server sets only options that the session lists, to values that the option lists, and reads each one back (SEC-16).
  - An imported session shows its current values.
  - K9 waits on K6, because `mode` is locked until K6 merges.
- **Tests:** Unit tests for the choice of controls by category. The fake process lists a `mode` option and an option with no category. A real chat with an agent change and with Autopilot off, in headless Chromium at 1440, 1024, and 390 px.

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
| H1 | `refactor/acp-harness` | D15 | Nothing (first) |
| K6 | `feat/kiro-approvals` | 6 | H1 |
| K7 | `feat/kiro-sessions` | 7 | H1 |
| K8 | `feat/kiro-credits` | 8 | H1 |
| K9 | `feat/kiro-session-options` | 9 | K6 |

Merge order: K1 to K5 (merged), then H1, K6, K7, K8, K9. Plan 2 (PRs 6 to 9) is merged in v1.2.0, so no PR waits on it. K6, K7, and K8 are built at the same time after H1. H1 splits `server/kiro/` so that the three PRs edit different files. K9 starts when K6 is merged.

Each PR updates `README.md` and `docs/CHANGELOG.md` where the behaviour changes:

- H1: the `server/` line in the project structure, and a "Changed" line in the changelog. No behaviour changes.
- K2: Kiro in the provider table and a "Kiro" part under "Connect a provider".
- K3: the sign-in steps.
- K5: chat with Kiro, what the chat input hides, credits under each reply, and `/api/kiro` in the route table.
- K6: tool approvals.
- K7: "Kiro sessions" under "Find a chat".
- K8: account credits.
- K9: session options in the chat input.

K2 also updates `.kiro/steering/CLAUDE.md` (provider and proxy tables) and `docs/SECURITY.md` (how the app starts Kiro and what it sends). H1 updates both `CLAUDE.md` files and `docs/SECURITY-LEARNINGS.md` (paths only).

Each PR is tested as the UI guidelines say. Before each push, the app runs in the background with `hc` and a tunnel, so you can test it from your desktop.

## Not in this plan

- A folder chip per chat (D6 (b)) and an agent picker (D9 (b) and (c)).
- Images and files for Kiro. Kiro accepts images and embedded text (`promptCapabilities`), but the app's attachments are Bedrock only today.
- Regenerate with `session/fork`. Kiro can fork a session at a message, so regenerate can come back later.
- Diffs for file edits in the work row ("coding steps" in `docs/UIUX-IMPROVEMENTS.md`).
- Kiro's slash commands, plans, and spec mode.
- Windows. kiro-cli runs on macOS and Linux.
