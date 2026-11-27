# UI and UX improvements

Status: Plan 1 (items 1 to 14) and [Plan 2](#plan-2) (items 15 to 18) are done. Both ship in release 1.2.0. Items 19 to 21 are done and ship in release 1.3.0. In [Plan 3](#plan-3-mcp-servers), items 22 and 23 are done and ship in release 1.4.0. Items 24 and 25 are planned. The decisions D14 to D19 are made. Last updated 2026-11-27. See [Progress](#progress) for the state of each item.

This document reviews the current chat UI and proposes changes, in order of impact. It also records the decisions made so far and the questions that are still open.

## Contents

- [Decisions](#decisions)
- [Progress](#progress)
- [What the product needs](#what-the-product-needs)
- [How the review was done](#how-the-review-was-done)
- [Scores today](#scores-today)
- [Proposals](#proposals)
- [Typography](#typography)
- [Empty state: centred composer](#empty-state-centred-composer)
- [Context, cost, search, and coding in the UI](#context-cost-search-and-coding-in-the-ui)
- [Projected scores](#projected-scores)
- [Delivery plan](#delivery-plan)
- [Open questions](#open-questions)
- [Plan 2](#plan-2)
- [Plan 3: MCP servers](#plan-3-mcp-servers)

## Decisions

| # | Question | Decision | Effect on the plan |
|---|---|---|---|
| D1 | Remove the sticky model badge and show a "Switched to…" divider when the model changes? | Approved | Part of item 4 |
| D2 | Keep only one of the theme controls in the header? | No. Keep the palette menu (with Light and Dark) and the moon button. | Item 9 is dropped |
| D3 | Save Preferences when a setting changes, and remove the Save button? | Approved | Item 11 moves from P3 to P2 |
| D4 | Which font? | Keep Inter and JetBrains Mono (bundled since PR #62). PR 2 sets the size, line height, line length, and spacing from [Typography](#typography). | Items 2 and 8, in PR 2 |
| D5 | Centred composer on an empty chat? | Approved | Item 13, in PR 4 |
| D6 | How tall is the chat input? | (b): three lines in an empty chat, two lines at the bottom | Item 15, PR 6 |
| D7 | How do the sidebar groups look? | (b): the groups stay collapsible, with larger headers. The app keeps the open groups after a reload. | Item 16, PR 7 |
| D8 | Which date groups? | (a): Today, Yesterday, Previous 7 days, Previous 30 days, then one group for each month | Item 16, PR 7 |
| D9 | What else does a sidebar row show? | (a): the time of the last message at the right. The "…" button takes its place on hover and focus. | Item 16, PR 7 |
| D10 | What does the globe button do when search is on by default? | (a): it changes the open chat only. The next chat starts from the preference again. | Item 17, PR 8 |
| D11 | What happens with models that cannot call tools? | (a): Ollama models without the "tools" capability get no tools, and the globe and MCP buttons say "This model cannot use tools" | Item 17, PR 8 |
| D12 | How do you start a rename in the header? | (a): click the title. A pencil button shows on hover and focus. | Item 18, PR 9 |
| D13 | Does a rename move the chat to the top of the sidebar? | (a): no. A rename keeps the date of the last message. | Item 18, PR 9 |
| D14 | When does the app start a local MCP server to check it? | (b) and (c): when Preferences closes and when you open the MCP popover, for complete servers only. Each server in Preferences also has a **Check** button. | Item 22, PR M1 |
| D15 | Which commands can a local MCP server use? | (a): any program, by a name on `PATH` or by a full path (`/` or `~/`). No relative paths. | Item 24, PR M3 |
| D16 | What does the form do with quotes in arguments and environment values? | (a): help text, and a warning under a field whose text starts and ends with the same quote. The value saves as typed. | Item 23, PR M2 |
| D17 | Which configuration files does the import read? | (a): the JSON files with `mcpServers` in the home folder (Kiro, Pi, Claude Code user servers, and Cursor, Claude Desktop, Gemini CLI, and Windsurf when they exist). No TOML. | Item 25, PR M4 |
| D18 | Are imported servers on or off? | (a): off | Item 25, PR M4 |
| D19 | Where does the import show? | (a): a line at the top of the MCP Servers tab with **Import** and **Not now**, and the list in the tab | Item 25, PR M4 |

## Progress

| Item | Title | PR | State |
|---|---|---|---|
| 1 | Correct the context and cost numbers | 1 `fix/context-usage` ([#63](https://github.com/praveenc/local-llm-ui/pull/63)) | Done, merged |
| 5 | Usage on every reply | 1 `fix/context-usage` ([#63](https://github.com/praveenc/local-llm-ui/pull/63)) | Done, merged |
| 6 | Context meter states | 1 `fix/context-usage` ([#63](https://github.com/praveenc/local-llm-ui/pull/63)) | Done, merged |
| 2 | Comfortable reading column | 2 `feat/typography` ([#64](https://github.com/praveenc/local-llm-ui/pull/64)) | Done, merged |
| 8 | Calmer surfaces | 2 `feat/typography` ([#64](https://github.com/praveenc/local-llm-ui/pull/64)) | Done, merged |
| 14 | README | 2 `feat/typography` ([#64](https://github.com/praveenc/local-llm-ui/pull/64)) | Done, merged |
| 3 | Work row | 3 `feat/work-row` ([#65](https://github.com/praveenc/local-llm-ui/pull/65)) | Done, merged |
| 7 | Web search state in words | 3 `feat/work-row` ([#65](https://github.com/praveenc/local-llm-ui/pull/65)) | Done, merged |
| 4 | Fewer controls | 4 `feat/lean-chrome` ([#67](https://github.com/praveenc/local-llm-ui/pull/67)) | Done, merged |
| 10 | Conversation search | 4 `feat/lean-chrome` ([#67](https://github.com/praveenc/local-llm-ui/pull/67)) | Done, merged |
| 13 | Centred composer | 4 `feat/lean-chrome` ([#67](https://github.com/praveenc/local-llm-ui/pull/67)) | Done, merged |
| 11 | Preferences save on change | 5 `feat/preferences-autosave` ([#68](https://github.com/praveenc/local-llm-ui/pull/68)) | Done, merged |
| 12 | Accessibility polish | 5 `feat/preferences-autosave` ([#68](https://github.com/praveenc/local-llm-ui/pull/68)) | Done, merged |
| 9 | One theme control | None | Dropped (D2) |
| 15 | A more comfortable chat input | 6 `feat/composer-comfort` ([#70](https://github.com/praveenc/local-llm-ui/pull/70)) | Done, merged |
| 16 | Sidebar groups with more structure | 7 `feat/sidebar-groups` ([#71](https://github.com/praveenc/local-llm-ui/pull/71)) | Done, merged |
| 17 | Web search on by default | 8 `feat/web-search-default` ([#72](https://github.com/praveenc/local-llm-ui/pull/72)) | Done, merged |
| 18 | Rename a chat from the header | 9 `feat/rename-title` ([#73](https://github.com/praveenc/local-llm-ui/pull/73), stacked on #72) | Done, merged |
| 19 | Current provider first in the model picker | `fix/model-picker-order` ([#85](https://github.com/praveenc/local-llm-ui/pull/85)) | Done, merged ([#85](https://github.com/praveenc/local-llm-ui/pull/85)) |
| 20 | Replies keep running in their own chat | `fix/background-replies` | Done, merged ([#88](https://github.com/praveenc/local-llm-ui/pull/88)) |
| 21 | Totals of the whole chat in the context popover | `feat/chat-totals` ([#89](https://github.com/praveenc/local-llm-ui/pull/89)) | Done, merged ([#89](https://github.com/praveenc/local-llm-ui/pull/89)) |
| 22 | MCP servers that fail say why, and recover | M1 `fix/mcp-npx-launch` ([#93](https://github.com/praveenc/local-llm-ui/pull/93), stacked on [#92](https://github.com/praveenc/local-llm-ui/pull/92)) | Done, merged ([#93](https://github.com/praveenc/local-llm-ui/pull/93)) |
| 23 | Clearer Add MCP server form | M2 `fix/mcp-server-form` ([#92](https://github.com/praveenc/local-llm-ui/pull/92)) | Done, merged ([#92](https://github.com/praveenc/local-llm-ui/pull/92)) |
| 24 | Local servers that are standalone programs | M3 `feat/mcp-standalone-commands` | Planned, waits on M1 and M2 |
| 25 | Import MCP servers from other tools | M4 `feat/mcp-import` | Planned, waits on M3 |

### Found during the work

- **Model picker search (PR 1 testing).** A search with a dot finds nothing: "Haiku 5.5" shows "No models found", but "Haiku 5" lists Claude Haiku 5.5. Fixed in PR 4: the search also matches the model name.
- **Context window per model.** Claude 4.6 and later models have a 1M-token window. The app used 200K for all Claude models. PR 1 fixes this for Anthropic, Bedrock, and OpenRouter.
- **Composer width (PR 2).** The chat input stays 896 px wide in PR 2, wider than the 768 px reading column. With a long model name such as "Global Anthropic Claude Haiku 5.5 Amazon Bedrock", the toolbar does not fit in one row at 768 px, and it wraps to two rows also at 896 px when the context indicator shows. Fixed in PR 4: the chip shows a short name, and the input is 768 px with the toolbar on one row.
- **Sticky model badge (PR 2).** The badge covered the first line of the reply under it while you scroll. Fixed in PR 4: the badge is removed (D1).
- **Tool calls were not stored (PR 3).** A reply kept its thinking and its answer, but not its searches or tool calls, so they were gone when the chat opened again. PR 3 stores each call with a compact result: up to 10 results for each search (title, link, and 400 characters of text), and the first 8,000 characters of other output.
- **Failed tools looked like they ran forever (PR 3).** The proxies did not send the AI SDK `tool-error` part, so a failed tool kept its spinner. PR 3 sends it as a `toolResult` with an `error`, in all six AI SDK proxies.
- **Thinking time was not known.** The model sends no thinking duration. PR 3 estimates it in the browser: each wait that ends with a thinking chunk counts, from the time the request is sent.

## What the product needs

The app is a chat client today. It will grow into a harness for chat, web search, lean context management, low cost, and later coding tasks. These jobs drive the design:

1. **Read long answers.** Users spend most of their time reading replies, so the reply column must be comfortable to read.
2. **See the model's work.** Thinking, searches, tool calls, and later file edits must take little space but be easy to inspect.
3. **Control context and cost.** Users must see how full the context window is and what a chat costs. The numbers must be correct.
4. **Switch fast.** Changing model, chat, or tools must be quick, and no control may be duplicated without a reason or be ambiguous.
5. **Grow without clutter.** Coding steps must fit into the same patterns as search steps. They must not add new panels to the chat by default.

## How the review was done

- Screenshots of the home view, a chat in progress, the theme menu, and Preferences (Providers and Display).
- A read of the UI code in `src/`, with file and line references below.
- WCAG 2 contrast ratios for all eight theme variants, calculated from the colour tokens in `src/styles/globals.css` and `src/styles/themes.css`.
- Font metrics (x-height, mean letter width, OpenType features, file size) read from the font files with fontTools.

## Scores today

Each category is scored from 1 to 10.

| # | Category | Why it matters here | Score | Main gaps |
|---|---|---|---|---|
| 1 | Reading comfort | Most of the time is spent reading answers | 5 | Replies use `text-sm` (14 px) in an 896 px column (`max-w-4xl`, `ChatContainer.tsx:367`), about 115 to 120 characters per line. At the time of the review, Inter and JetBrains Mono were named in the CSS but not loaded. PR #62 now bundles them. |
| 2 | Visual hierarchy | The answer must stand out more than the controls around it | 6 | The "Thought for…" chip is the most saturated element in a turn. The model name shows in four places: the sidebar header, the sticky badge, the model picker, and the empty state. |
| 3 | Colour and eye comfort | The UI must be easy on the eyes for long sessions | 6 | All text passes 4.5:1 (see the table below). Neutral Light body text is 18:1, with white cards on a near-white page, which gives glare. At the time of the review there was no System appearance. PR #62 added one (commit 7323084). |
| 4 | Chrome economy | Less clutter now, and space for later features | 5 | The composer row has nine controls. "Global Anthropic Claude Haiku 5.5 Amazon Bedrock" takes about 40% of that row. The token row adds "Generated by AI", arrows, and a ⏱ glyph. |
| 5 | Consistency | One look and one behaviour for each concept | 5 | The header applies theme changes at once, but Preferences needs Save. Tool cards and the reasoning chip look different. MCP tools say "Searching...". **Clear chat** uses a trash icon but deletes nothing. |
| 6 | Core flows | Start a chat, switch model, find an old chat | 6 | Cmd+K and `/` work well. There is no conversation search. Groups other than Today are collapsed. **Clear chat** does the same as **New Conversation** (`AppShell.tsx:204`). |
| 7 | Work transparency | Search now, coding later | 5 | Each tool call is a separate card, not grouped (`ChatContainer.tsx:394`). Reasoning and tools are separate blocks. While a step runs, the only status is "Searching...". There is no list of sources. |
| 8 | Context and cost | Lean context and low cost are product goals | 3 | The numbers are wrong. See the next section. |
| 9 | Feedback and state | The user must always know what the app is doing | 7 | The stream announcer, stop button, error alert with Retry, and toasts work well. Web search "on" shows only as a faint tint. The scroll-to-bottom button sits on top of the text. |
| 10 | Accessibility and responsive layout | Keyboard, screen reader, touch, narrow windows | 7 | Labels are good, touch targets are 44 px, and narrow windows get a sheet. Message action icons are 12 px. The tool and reasoning triggers have no focus ring of their own. `animate-pulse` and `animate-in` ignore reduced motion. |

Average today: 5.5.

### Context and cost: current defects

- The server sends `result.usage` from `streamText` (for example `server/bedrock-aisdk-proxy.ts:406`). In AI SDK 7 this is the sum of all steps. In a tool loop each step sends the full history again, so one reply with five steps reports about five times the real context size.
- The browser then adds the usage of every turn together (`useBedrockChat.ts:483`). Each request already contains the whole history, so the ring overstates context use more with each turn.
- The ring and the token row disappear when a chat is opened again. The usage is stored with each message (`useBedrockChat.ts:506`), but it is not loaded back (`types/ai-messages.ts:100`).
- The price table stops at Claude 4.5 (`utils/anthropicPricing.ts:16`). A model with no price shows **$0.00** instead of "unknown".
- Cached tokens and reasoning tokens are not recorded. AI SDK 7 reports them in `inputTokenDetails.cacheReadTokens`, `inputTokenDetails.cacheWriteTokens`, and `outputTokenDetails.reasoningTokens`.

### Contrast today

WCAG 2 contrast ratios, calculated from the theme tokens.

| Theme | Body text on page | Muted text on page | Muted text on sidebar | Primary on page | Border on page |
|---|---|---|---|---|---|
| Neutral Light | 18.09 | 5.80 | 5.55 | 5.75 | 1.21 |
| Neutral Dark | 16.13 | 7.49 | 7.17 | 9.11 | 1.32 |
| Cosmic Night Light | 12.68 | 5.14 | 4.92 | 4.98 | 1.20 |
| Cosmic Night Dark | 14.89 | 7.51 | 6.73 | 7.21 | 1.51 |
| Cobaltz Light | 15.24 | 5.22 | 4.94 | 4.99 | 1.19 |
| Cobaltz Dark | 15.79 | 6.02 | 5.61 | 10.44 | 1.48 |
| Rosé Pine Dawn | 8.69 | 5.54 | 5.82 | 5.59 | 1.27 |
| Rosé Pine Main | 13.39 | 5.48 | 5.12 | 10.45 | 1.30 |

## Proposals

Effort is relative. **S** is one or two files. **M** is several components and their tests. **L** is a new data flow. All proposals use existing shadcn parts (Collapsible, Popover, Sheet, DropdownMenu, Input, Tooltip) and add no runtime dependency. Existing features stay unless a proposal changes them.

### P1: highest impact

#### 1. Correct the context and cost numbers, and keep them after a reload

- **Categories:** Context and cost, Feedback and state. **Effort:** M.
- **Problem:** The context ring overstates use, all usage disappears after a reload, and unknown prices show $0.00.
- **Change:**
  - The server sends two values for each reply. *Reply usage* is the sum of all steps, for cost. *Context size* is the input and output tokens of the last step, for the ring.
  - The ring shows the context size of the last reply. That is what the next request will carry.
  - Cost is the sum of reply usage over the chat.
  - When a chat opens, both values are rebuilt from the usage stored with each message.
  - The usage type stores cached input tokens and reasoning tokens.
  - A model with no price shows "No price data". The price table gets current models and a source date.
- **Trade-offs:** Cost shows only for models with a known price. Older stored messages have no context size; for those, the ring uses their stored totals until the next reply.

#### 2. A comfortable reading column

- **Categories:** Reading comfort, Visual hierarchy, Colour and eye comfort. **Effort:** S, plus the font work in [Typography](#typography).
- **Problem:** Lines are too long, the text is small, and the font changes from machine to machine.
- **Change:** a column of 768 px (`max-w-3xl`), reply text of about 15 px with a line height of 1.6 to 1.65, and paragraphs capped at 70 characters (`70ch`). Code blocks and tables use the full column width. The full rules are in [Typography](#typography).
- **Trade-offs:** Fewer words fit on one screen.

#### 3. One "work" row for each reply, for thinking and tool calls

- **Categories:** Work transparency, Visual hierarchy, Consistency. **Effort:** M.
- **Problem:** One card for each call pushes the answer down. The reasoning chip competes with the answer. The two blocks use different styles.
- **Change:** one Collapsible row above the answer, in muted text.
  - While the reply runs, the row shows the current step, for example `Searching "riemann zeros primes" · Brave`.
  - After the reply, the row shows a summary, for example `Thought 4 s · 3 searches · 18 sources · 1 fetch`.
  - When expanded, the row lists the steps in order: the thinking text, each search with its query and the domains of its results, and each MCP call with its main argument.
  - The tinted reasoning chip is removed.
- **Trade-offs:** One more click to see the result of one tool. Steps use today's order (reasoning first, then tools). Showing the exact order of message parts is a later change.
- **Done in PR 3:** `src/components/ai-elements/work-row.tsx` replaces the Thinking chip and the tool cards. The live step and the summary come from `src/utils/workSummary.ts`. Search steps list the sites of their results without a click. MCP steps show the short tool name (`fetch`, not `fetchv2__fetch`; the full name is the tooltip) and the text of the output. The steps are stored with the reply. The `motion` package went with the old shimmer.

#### 4. Fewer controls in the composer and the header

- **Categories:** Chrome economy, Visual hierarchy, Consistency, Core flows. **Effort:** M.
- **Problem:** The model name shows four times, the composer row is crowded, and a trash icon does an action that deletes nothing.
- **Change:**
  - The model chip shows a short name with the inference profile, for example `Claude Haiku 5.5 · Global`. The provider logo stays, and the tooltip shows the full name and provider.
  - The sticky model badge is removed (D1). When the model changes in a chat, a one-line divider shows in the transcript: "Switched to Claude Sonnet 5.5". Each stored message already has `modelName` (`db/types.ts:47`), so the divider also shows in older chats.
  - The model line under the product name in the sidebar is removed.
  - **Clear chat** is removed from the composer. A **New chat** button goes in the header.
  - **Save prompt** moves into the **+** menu as "Save as prompt".
- **Trade-offs:** The provider name is no longer visible as text at a glance. The short-name rules must keep Global and US profiles apart.
- **Done in PR 4:**
  - `src/utils/modelLabel.ts` makes the short name. The profile comes from the model ID prefix (`global.`, `us.`, `eu.`, ...), not from the name, so Global and US stay apart. The 92 Bedrock models in the test account give 92 different labels; the longest has 38 characters. The picker list uses the same labels.
  - The "Switched to" line goes before the user message that starts the reply from the new model. The usage tooltip under each reply names its model, because the badge is gone.
  - The header button is **New chat** (a pencil icon). Clear chat called the chat hook's clear function directly and did not reset the default model; New chat does both.

#### 5. Usage on every reply, in the existing action row

- **Categories:** Context and cost, Chrome economy. **Effort:** S.
- **Problem:** The token row shows only for the last reply, takes a row of its own, and disappears after a reload.
- **Change:** At the right end of the row with the thumbs and copy buttons, in muted text with tabular figures: `1.2k in · 342 out · 2.1 s · $0.0029`. "Generated by AI", the arrows, and the ⏱ glyph are removed. The values come from the usage stored with each message.
- **Trade-offs:** None of note. The cost is left out when there is no price.

### P2

#### 6. Context meter states

- **Categories:** Context and cost. **Effort:** S, after item 1.
- **Change:** The ring takes the warning colour at 70% and the danger colour at 90%. The popover then also says "Near the limit" in words, so colour is not the only signal. The popover shows the chat cost, cached tokens, and reasoning tokens.
- **Trade-offs:** None of note. The ring stays the same size.

#### 7. Web search state in words

- **Categories:** Feedback and state, Accessibility. **Effort:** S.
- **Change:** When search is on, the globe button becomes a chip with the text "Search", like the Thinking chip. When search is off, only the icon shows. MCP tools that run say "Running…", not "Searching...".
- **Trade-offs:** The chip is about 70 px wider when search is on.
- **Done in PR 3:** the Search chip, and "Running…" for MCP tools in the work row.

#### 8. Calmer surfaces

- **Categories:** Colour and eye comfort. **Effort:** S to M.
- **Change:**
  - The theme tint stays on small accents only: the active row, links, the focus ring, and the send button.
  - Body text targets 12:1 to 15:1, not 18:1.
  - The colour of cards and the composer moves closer to the page colour, to reduce glare.
  - ~~A **System** appearance follows the OS light or dark setting.~~ Done in PR #62.
  - The contrast table above is calculated again for all eight variants before and after the change. Muted text must stay at 4.5:1 or more.
- **Trade-offs:** The themes look a little less different from each other.
- **Done in PR 2:**
  - Neutral body text: `#222222` on the light page (15.2:1, was 18.1:1) and `#e0e0e0` on the dark page (14.3:1, was 16.1:1). The other themes keep their own text colours.
  - The user's messages and the avatar use `--surface-quiet`, a 5% (light) or 7% (dark) mix of the text colour into the page, not the theme tint. Inline code uses it too. Code blocks have a neutral frame.
  - The chat input uses `--composer`, halfway between the card and the page.
  - Dark themes use thinner font smoothing on macOS.
  - Contrast after the change, calculated from the tokens:

    | Theme | Body text on page | Text on user message | Muted text on user message | Muted text on chat input |
    | --- | --- | --- | --- | --- |
    | Neutral Light | 15.24 | 13.86 | 5.27 | 5.92 |
    | Neutral Dark | 14.30 | 12.42 | 6.50 | 7.21 |
    | Cosmic Night Light | 12.68 | 11.59 | 4.70 | 5.35 |
    | Cosmic Night Dark | 14.89 | 12.94 | 6.52 | 7.14 |
    | Cobaltz Light | 15.24 | 13.85 | 4.75 | 5.32 |
    | Cobaltz Dark | 15.79 | 12.90 | 4.92 | 5.77 |
    | Rosé Pine Dawn | 8.69 | 8.04 | 5.12 | 5.68 |
    | Rosé Pine Main | 13.39 | 11.40 | 4.67 | 5.30 |

#### 10. Conversation search in the sidebar

- **Categories:** Core flows, Chrome economy. **Effort:** M.
- **Change:** A filter Input above the list searches conversation titles in IndexedDB. Groups with a match open. The chat icon on each row is removed.
- **Trade-offs:** Titles only. A search of message text is a later change.
- **Done in PR 4:** the filter is in the list component and filters the titles already loaded from IndexedDB, so it needs no new query. While it has text, every group with a match is open. Esc clears it.

#### 11. Preferences save on change (D3)

- **Categories:** Consistency, Feedback and state. **Effort:** M.
- **Change:**
  - Switches, radio buttons, and selects save when they change.
  - Text fields save on blur or when you push Enter.
  - API keys and the MCP server form keep their own Add or Save button. Credentials and forms with several fields need a deliberate action.
  - The dialog footer has one **Close** button and the text "Changes save automatically". A short "Saved" label shows next to a setting after it saves.
  - Theme changes in Preferences apply at once, so the palette menu, the moon button, and Preferences always agree (D2).
- **Trade-offs:** There is no Cancel to undo a change. The `PreferencesDialog` tests need updates.
- **Done in PR 5:**
  - Radio buttons, selects, switches, and the theme picker save at once. Typed values (the API keys, avatar initials, and MCP server fields, which change on each key press) save after 700 ms without typing, when focus leaves the field, on Enter, and when the dialog closes.
  - The footer says "Changes save automatically." and shows "Saved" for 2 seconds after a save, in a `role="status"` region. This is one place for the feedback, not a label next to each setting.
  - The footer button is **Done**, not Close, because the dialog's X button is already named Close.
  - The rule that the default provider needs an API key stays: a change that breaks it is not saved, and the dialog says "Not saved" until you select a different default provider. If you close the dialog first, that one change is dropped; the stored preferences stay valid.
  - The unsaved-changes prompt (Discard) is gone from Preferences. Quote and Ask keeps it.

### P3

#### 12. Accessibility polish

- **Categories:** Accessibility and responsive layout. **Effort:** S.
- **Change:** Message action icons go from 12 px to 16 px. The work row gets an explicit `focus-visible` ring. Reduced-motion guards are added to `animate-pulse` (`prompt-input.tsx:1197`) and `animate-in` (`reasoning.tsx:175`). The scroll-to-bottom button moves to the top edge of the composer, so it does not cover text.
- **Done in PR 5:**
  - The message action icons are 16 px.
  - The work row got its `focus-visible` outline in PR 3.
  - `animate-pulse` on the microphone button stops with reduced motion. The `animate-in`, `fade-in`, `zoom-in`, and `slide-in` classes on dialogs and menus have no effect: the app has no animation plugin for them (the built CSS has no such rules), so nothing moves.
  - The chat measures the height of the chat input and ends 48 px above it. The scroll-to-bottom button sits in that strip, so it covers no text. This also fixes the end of the chat that the input covered on phones, where its toolbar takes two or three rows.

#### 13. Centred composer on an empty chat (D5, approved)

- **Categories:** Visual hierarchy, Core flows. **Effort:** M. See [Empty state](#empty-state-centred-composer).
- **Done in PR 4:** the chat input is one element that changes its position, so its text and attachments stay when it moves. Without a model, the provider checklist shows above it in place of the heading. The note about an automatic model choice shows below it.

#### 14. README

- **Effort:** S. The README lists Cosmic Night, Cobaltz, and Rosé Pine, but not Neutral, which is now the default. The first PR that changes the UI fixes this.

### Dropped

- **9. One theme control in the header.** Dropped by D2. Item 11 removes the real inconsistency (Preferences needed Save, the header did not).

## Typography

Typography decides how comfortable the app is to read, so it gets its own decision (D4). This section gives the proposed rules, the candidate fonts with measured data, and how to choose.

### Proposed rules

| Element | Size | Line height | Other |
|---|---|---|---|
| Reply and user text | About 15 px for fonts with a tall x-height. Other fonts scale to the same x-height, about 8.2 px. | 1.6 to 1.65 | Paragraphs at most 70 characters wide. Paragraph gap 0.9 em. |
| Headings in replies | h2 1.2 em, h3 1.05 em, weight 600 | 1.3 | `text-wrap: balance` |
| Lists | Same as body | Same as body | 0.3 em between items, 1.25 em indent |
| Inline code | 0.875 em, or the size that matches the text x-height | Same as body | 1 px border, 4 px radius |
| Code blocks | 0.875 em (about 13 px) | 1.55 | `tab-size: 2` |
| Tables | 0.93 em | 1.45 | Tabular figures, numbers aligned right |
| UI text (sidebar, chips, menus) | 13 to 14 px | 1.3 to 1.4 | |
| Small metadata (usage, work row) | 12 to 13 px | 1.4 | Tabular figures. Muted colour stays at 4.5:1 or more. |

Other rules:

- **Letter spacing:** 0 for body text, so the font keeps the spacing its designer set for text sizes. Headings of 18 px or more in Inter or Geist can use −0.01 em.
- **Word spacing:** `normal`. No justified text, because justification stretches the gaps between words unevenly. No automatic hyphenation. The specimen has a word-spacing slider to check whether a font's default gap looks tight.
- **Line breaks:** `text-wrap: pretty` on paragraphs and list items, so a paragraph does not end with one short word on its own line. Browsers that do not support it ignore it.
- **Figures:** tabular figures in usage, cost, tables, and the context meter. Proportional figures in prose.
- **Weights:** regular 400, bold 600 (not 700). Light text on a dark background looks heavier, so dark themes can use 380 to 390 if the chosen font looks too heavy there.
- **Font smoothing:** decide in the specimen. On macOS, `-webkit-font-smoothing: antialiased` makes text thinner, which often helps in dark themes.
- **Italics:** real italic files, not slanted regular letters. All candidates below include italic files.
- **Ligatures in code:** off (`font-variant-ligatures: none`), so `!=` and `=>` show the characters that are in the file.
- **One family** for the UI and the replies, unless a serif is chosen for replies.

### Candidate fonts

All candidates use the SIL Open Font License 1.1. The data comes from the Fontsource 5.3 files, Latin subset, variable weight. x-height and width are fractions of the font size. Width is the mean advance of the letters a to z.

| Text font | x-height | Width | `tnum` | Paired code font (x-height) | Download: regular + italic + code |
|---|---|---|---|---|---|
| System UI (SF Pro, Segoe UI) | Depends on OS | Depends on OS | Depends on OS | System mono | 0 KB |
| Inter | 0.546 | 0.536 | Yes | JetBrains Mono (0.550) | 137 KB |
| Geist | 0.530 | 0.534 | Yes | Geist Mono (0.530) | 82 KB |
| IBM Plex Sans | 0.516 | 0.505 | No | IBM Plex Mono (0.516) | 108 KB |
| Source Sans 3 | 0.478 | 0.448 | No | Source Code Pro (0.478) | 78 KB |
| Atkinson Hyperlegible Next | 0.496 | 0.487 | Yes | Atkinson Hyperlegible Mono (0.496) | 87 KB |
| Literata (serif, for replies only) | 0.507 | 0.555 | Yes | JetBrains Mono (0.550) | 104 KB, plus the code font |

What the measurements show:

- **Size depends on x-height.** At 15 px, Inter has an x-height of 8.2 px and Source Sans 3 has 7.2 px. Source Sans 3 needs about 17 px to look the same size as Inter at 15 px.
- **Each family has a code font with the same x-height.** With a matched pair, inline code sits level with the words around it.
- **The Fontsource files have no stylistic sets** (no `ss01` to `ss08`, no `cv01` to `cv13`). In Inter, the default `l` and `I` look almost the same. Inter's alternate shapes that tell them apart are only in the official Inter release, which is a larger file. Atkinson Hyperlegible Next makes look-alike letters distinct by default.
- **IBM Plex Sans and Source Sans 3 have no `tnum` feature** in these files. `tabular-nums` then has no effect, and digits align only if the default figures already have equal widths.
- **The downloads are small**, 78 KB to 137 KB, and the browser loads them once and caches them.

### How to choose

A type specimen page shows each candidate with the same reply: a user message, the proposed work row, an italic line, headings, a list, inline code, a code block, a table of tokens and cost, and a line of look-alike characters. It uses the colours of all eight theme variants. The specimen is not part of the repository.

Check these points:

1. Look at the **Reply** view at your normal window size, in light and dark themes.
2. Read the look-alike line (`Il1| O0o rn m`) and the model ID.
3. Check that the digits in the table align.
4. Check that inline code looks the same height as the words around it.
5. Check that the italic line is a real italic.
6. In dark themes, turn **Antialiased** on and off.
7. Open **Compare all** with **Equal x-height** on, to compare the letter shapes at the same visual size.
8. Tune the size, line height, word spacing, and line length. Then use **Copy settings** and paste the result into the review.

### How to bundle a different font

- PR #62 uses the `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` packages, imported in `src/main.tsx`. Each subset is its own `@font-face` with a `unicode-range`, so the browser loads only the subsets that a page uses.
- To change the font, replace those two packages with the packages of the new pair and update the font stacks in `src/styles/globals.css`. Keep `font-display: swap`.
- If the distinct `l` and `I` shapes of Inter are wanted, the Fontsource files cannot give them. The official Inter release has them, but it is a larger file. Measure it before that decision.

### Provisional lean

Two finalists to check first:

- **Inter with JetBrains Mono.** This is what the app bundles since PR #62. It has the tallest x-height, so it stays legible at small UI sizes. Its default `l` and `I` look alike.
- **Atkinson Hyperlegible Next with its mono.** Look-alike letters are distinct by default, the x-heights match, and the download is 87 KB. It needs about 16 px to look the same size as Inter at 15 px.

If the review keeps Inter, PR 2 changes only the size, line height, line length, and spacing. If it picks another font, PR 2 also replaces the Fontsource packages.

## Empty state: centred composer

This explains D5.

Today, a new chat shows "Ready to chat" in the middle of the window, and the message box is at the bottom. Your eyes go to the middle, but you type at the bottom. In the screenshot of the home view, the gap between the two is about 360 px.

```text
Today                                   Centred composer
┌────────────────────────────────┐      ┌────────────────────────────────┐
│                                │      │                                │
│          Ready to chat         │      │     What can I help with?      │
│   Send a message to start…     │      │ ┌────────────────────────────┐ │
│                                │      │ │ What would you like to…    │ │
│                                │      │ │ + Model · Thinking   ○ ⬆   │ │
│        (empty, ~360 px)        │      │ └────────────────────────────┘ │
│                                │      │   Saved prompts · Providers    │
│ ┌────────────────────────────┐ │      │                                │
│ │ What would you like to…    │ │      │                                │
│ │ + Model · Thinking   ○ ⬆   │ │      │                                │
│ └────────────────────────────┘ │      │                                │
└────────────────────────────────┘      └────────────────────────────────┘
```

With a centred composer:

- On an empty chat, the message box sits in the middle of the window, under a short heading. You look and type in the same place.
- The space under the box can hold short links that help you start, for example saved prompts or the provider checklist that shows today when no model is ready.
- When you send the first message, the box moves to the bottom and stays there for the rest of the chat, as it does today.
- The "Send a message to start chatting with …" line is removed, because the model chip already shows the model.

Trade-offs:

- The box moves once, at the first send. With reduced motion on, it moves without animation.
- The composer is positioned at the bottom with `absolute` today (`ChatContainer.tsx:489`), so this change touches the layout of the chat container.

A smaller alternative is to keep the box at the bottom and only remove the "Ready to chat" block. That fixes the repeated model name but not the distance between where you look and where you type.

Decision (D5): approved, as a P3 item in PR 4, after items 1 to 5.

## Context, cost, search, and coding in the UI

| What | Where | When it shows |
|---|---|---|
| Context fill | The ring in the composer, with colour and words at 70% and 90% | When the last reply came from the selected model, also after a reload. Otherwise the chip shows only the totals (item 20). |
| Cost | The usage text of each reply, and the chat total of all models in the context popover | Only when the price is known. Unpriced replies are counted in words. Never in the sidebar. |
| Web search | The "Search" chip in the composer, the current step in the work row, and the sources when the row is expanded | Chip: when search is on. Current step: while the reply runs. |
| Coding steps (later) | The same work row, with steps such as `Read src/x.ts`, `Edit src/x.ts +12 −3`, and `Ran npm test` | Collapsed by default |
| Diffs and long output (later) | A Sheet on the right, opened from a step | Closed by default, so the column keeps its width |
| Tool approvals (later) | Approve and Deny buttons on that step in the work row, not a modal dialog | Only when a tool that writes or runs something asks |
| Workspace (later) | A folder chip in the composer | Only when a file system tool is connected |
| Lean context (later) | A "Compact chat" action in the context popover | From 80% context use |

The work row and the context popover hold most of the later harness features. The chat column stays the same.

## Projected scores

| Category | Now | After P1 and P2 | Main items |
|---|---|---|---|
| Reading comfort | 5 | 9 | 2 and the font decision |
| Visual hierarchy | 6 | 9 | 2, 3, 4 |
| Colour and eye comfort | 6 | 9 | 8 |
| Chrome economy | 5 | 9 | 4, 5 |
| Consistency | 5 | 9 | 3, 11 |
| Core flows | 6 | 9 | 4, 10 |
| Work transparency | 5 | 9 | 3, 7 |
| Context and cost | 3 | 9 | 1, 5, 6 |
| Feedback and state | 7 | 9 | 7, 11 |
| Accessibility and responsive layout | 7 | 9 | 12 (P3) |

These are targets. Each PR checks them with the contrast calculation, screenshots of all eight theme variants, a keyboard-only test, and `make check`.

## Delivery plan

One PR for each group, in this order:

| PR | Branch | Items | Waits on |
|---|---|---|---|
| 1 | `fix/context-usage` | 1, 5, 6 | Nothing |
| 2 | `feat/typography` | 2, 8, 14 | Nothing (PR 1 merged as #63) |
| 3 | `feat/work-row` | 3, 7 | Nothing (PR 2 merged as #64) |
| 4 | `feat/lean-chrome` | 4, 10, 13 | Nothing |
| 5 | `feat/preferences-autosave` | 11, 12 | Nothing (PR 4 merged as #67) |

Each PR updates `README.md` and `docs/CHANGELOG.md` where the behaviour changes.

## Open questions

None. D4 is decided: Inter and JetBrains Mono stay. D6 to D13 are decided: see [Decisions](#decisions).

## Plan 2

Plan 2 starts after PRs #63 to #69. It adds four items (15 to 18) and the decisions D6 to D13. All decisions have answers; the [Decisions](#decisions) table records them.

Evidence comes from `main` at `6d09748` and from three screenshots of 2026-11-24: an empty chat (Grok 4.7), the Saved Prompts dialog, and an open chat with the header title marked "Make this editable".

### 15. A more comfortable chat input

- **Categories:** Visual hierarchy, Core flows. **Effort:** S.
- **Problem:** The chat input looks cramped. It shows one line of text, the text sits close to the toolbar, and the toolbar buttons almost touch. The empty chat uses the same small card under a 24 px heading, so the input does not look like the main control of the page.
- **Evidence:**
  - `ChatContainer.tsx:572`: the textarea is `min-h-14 px-4 pt-4 pb-1`. 56 px fits one line of 15 px text (24 px high at line height 1.625) and 20 px of padding.
  - `ChatContainer.tsx:572` and `:574`: 4 px under the text (`pb-1`) and 4 px above the toolbar (`pt-1`) leave 8 px between the text and the buttons.
  - `ChatContainer.tsx:575` and `:616`: 2 px between toolbar buttons (`gap-0.5`).
  - `ChatContainer.tsx:574`: 10 px around the toolbar (`px-2.5 pb-2.5`), less than the 16 px around the text.
  - `prompt-input.tsx:901`: the textarea grows to 192 px (`max-h-48`), about 7 lines, and then scrolls.
  - `ChatContainer.tsx:527` and `:528`: the empty chat and the bottom position use the same textarea height.
  - Screenshots 1 and 3.
- **Fix** (D6 (b)):
  - The textarea shows two lines at the bottom and three lines in an empty chat. That is about 72 px and 96 px.
  - 12 px between the text and the toolbar. 12 px around the toolbar, so the space inside the card is even.
  - 4 px between toolbar buttons (`gap-1`).
  - The textarea grows to 40% of the window height, at most 320 px, before it scrolls.
  - No shadow and no new colour. The card keeps its border and `--composer` fill (item 8).
  - The toolbar must stay on one row at 768 px with the longest model label (38 characters), the Thinking chip, the Search chip, and the context ring. Measure this in the browser before the PR opens.
- **Trade-offs:** At the bottom, the input is 16 px taller, so a phone shows a little less of the chat. The chat already ends above the measured input height (item 12), so no text goes under it.
- **Done in PR 6:**
  - The minimum height is a whole number of lines of the textarea's own line height: `calc(3lh + 1.5rem)` in an empty chat and `calc(2lh + 1.5rem)` at the bottom. Measured in Chromium: 97 px (3 lines) and 73 px (2 lines) at 15 px, and 102 px and 76 px at 16 px on a phone. Compact density keeps the line counts.
  - 12 px between the text and the toolbar, 12 px around the toolbar, and 4 px between buttons. The textarea stops at `min(40vh, 320px)` and then scrolls: 320 px in a 900 px window, 240 px in a 600 px window.
  - At a 1024 px window the chat input is 704 px wide. With Claude Sonnet 4.6 · Global, XHigh, Search on, and the context ring, the toolbar needed 44 px more, and it already wrapped before this PR. The word "Thinking" now hides when the chat input is narrower than 768 px (a container query). The icon, the level, and the accessible name ("Thinking: XHigh") stay. The toolbar is then one row at 1440 and 1024 px for 20 Claude models and the longest label (38 characters), with at least 15 px free.
  - At 390 px the toolbar takes three rows, as before this PR.
  - The empty Saved Prompts list says "Type a prompt in the chat input, click +, and then click Save as prompt."

### 16. Sidebar groups with more structure

- **Categories:** Core flows, Visual hierarchy. **Effort:** M.
- **Problem:** The groups look like a plain file tree. Each header is a small grey line with a 12 px chevron and a count in brackets. Only one group is open when the app loads, so most chats are hidden behind closed groups. Each row has only its title, so rows look the same and give no sense of time. The groups use rolling windows with unclear names: "This Month" holds chats from 8 to 30 days ago, and "Older" holds everything before that in one long group.
- **Evidence:**
  - `ConversationList.tsx:61` to `:62`: "This Week" is the last 7 days and "This Month" is the last 30 days, not the calendar week or month.
  - `ConversationList.tsx:65` to `:69`: the labels use title case ("This Week"). UI text is sentence case (guidelines, Controls and settings).
  - `ConversationList.tsx:124` to `:137`: only Today opens, or Yesterday, or the first group. The open groups are in memory only (`:119`) and reset on reload.
  - `ConversationList.tsx:232` and `:235`: 12 px header text and a 12 px chevron. The guidelines ask for icons of 16 px or more.
  - `ConversationList.tsx:240`: the count "(12)" after each header.
  - `ConversationList.tsx:249` and `:282`: each row is the title in 14 px, and nothing else.
  - Screenshots 1 to 3: "This Month (12)" with eight rows that start "I have vast knowledge…" or "Find out everything…". Screenshot 2 shows three closed groups.
- **Fix** (D7 (b), D8 (a), D9 (a)):
  - The groups stay collapsible. A group header is 13 px, weight 500, muted, in sentence case, with a 16 px chevron and 12 px of space above it. On touch screens the header is 44 px high.
  - The app stores the open groups in the browser (`localStorage`), so they stay the same after a reload. Groups that you have not opened or closed yet use the default: Today, Yesterday, and Previous 7 days open, older groups closed.
  - A closed group shows its number of chats at the right, without brackets ("12"), so you can see how many chats it hides. An open group shows no number.
  - The header of the group you scroll through stays at the top of the list (`position: sticky`), so you always see the period of the rows under it, and can close the group from there.
  - Groups follow the calendar: Today, Yesterday, Previous 7 days, Previous 30 days, then one group for each month ("October", or "October 2025" for an earlier year).
  - Each row shows the time of its last message at the right, in 12 px muted text with tabular figures: "14:05" in Today and Yesterday, "Mon" in Previous 7 days, "12 Oct" in older groups. The browser's locale sets the format.
  - The "…" menu button takes the place of the time on hover and focus, so the title does not get narrower. On touch screens the button always shows, as it does today, next to the time.
  - The open chat keeps its look (`bg-sidebar-active`, `text-tint-text`).
  - Each header button is inside an `h3`, under the "Conversations" `h2` (`Sidebar.tsx:46`), so a screen reader can move from group to group. The button has `aria-expanded`.
  - The list loads all active chats, not only the 50 newest (see [Found during the planning](#found-during-the-planning)).
  - Search works as today: it opens every group with a match, and it does not change the stored open groups.
  - Compact density keeps less space between rows and groups.
- **Trade-offs:** Closed groups still hide chats, but you choose which ones, and the choice stays. A month group gets a new key each month, so it starts closed.
- **Done in PR 7:**
  - `src/utils/conversationGroups.ts` holds the groups, the row time, and the open state (`localStorage` key `local-llm-ui-sidebar-groups`). It has no DOM or React imports.
  - The time of day uses the locale's short format: "14:05" in en-GB, "3:05 PM" in en-US. The groups change at the next update of the list after midnight, not at midnight.
  - A closed group's button is named, for example, "Previous 30 days, 14 chats", and its digits are hidden from screen readers. A hidden word next to the digits was read as "Previous 30 days14chats".
  - The sticky headers needed no change: `scroll-area.tsx` already makes the Radix wrapper `display: block`.
  - Muted text on the active row is below 4.5:1 in four variants, so the time on the active row uses the row's own text colour (`--tint-text`):

    | Theme | Muted on sidebar | Muted on active row | Tint text on active row |
    | --- | --- | --- | --- |
    | Neutral Light | 5.55 | 4.69 | 4.66 |
    | Neutral Dark | 7.17 | 5.58 | 6.79 |
    | Cosmic Night Light | 4.89 | 4.20 | 4.90 |
    | Cosmic Night Dark | 6.73 | 5.36 | 5.15 |
    | Cobaltz Light | 4.94 | 4.20 | 4.69 |
    | Cobaltz Dark | 5.61 | 4.09 | 7.10 |
    | Rosé Pine Dawn | 5.82 | 4.93 | 4.98 |
    | Rosé Pine Main | 5.12 | 3.74 | 7.13 |

  - Tested with 70 seeded chats from today to 16 months ago and one real Bedrock chat: all 71 show, and the title keeps its width when the "…" button replaces the time.
  - Found: the "…" button is 24 px, below the 44 px touch target. This PR does not change it.

```text
Conversations
[ Search chats              ]
⌄ Today                        <- stays at the top while you scroll
  continual-learning     14:05
  system-design          09:12
⌄ Yesterday
  Find out everything…   18:40
⌄ Previous 7 days
  Howdy, Haiku. Tell…      Mon
› Previous 30 days           8
› October                   12
```

### 17. Web search on by default

- **Categories:** Core flows, Chrome economy. **Effort:** M.
- **Problem:** Web search starts off. You must click the globe button in each session before the model can search. There is no preference for it. Without a search key, the globe button still shows, at half opacity, and does nothing.
- **Evidence:**
  - `ChatContainer.tsx:192`: `useState(false)`. The state lives in the chat container. The container has no `key` (`AppShell.tsx:260`), so the state stays the same across chats in one session and goes back to off on reload.
  - `webSearch.ts:28` to `:36`: the web search preferences hold the keys, the primary provider, and the fallback switch. There is no setting for search on or off.
  - `WebSearchToggle.tsx:32` to `:36`, `:52`, and `:56`: without a key, the button shows with `opacity-50` and `aria-disabled`, and the tooltip asks for a key.
  - `useBedrockChat.ts:228` and `:240` to `:241`: the request sends `enableWebSearch`, and the key headers only when it is on.
  - `ollama-aisdk-proxy.ts:130`: when a request asks for search but has no key, the proxy returns an error. The browser must not send `enableWebSearch: true` without a key.
  - `ollama-aisdk-proxy.ts:146` to `:150`: the proxy sends the tools to every model. `ollama.ts:23` to `:28` reads the model capabilities only for thinking.
- **Fix:**
  - A new preference, `webSearchByDefault`. It is on when it is not set (`prefs.webSearchByDefault !== false`), the same pattern as `isWebSearchFallbackEnabled` (`webSearch.ts:76`). Existing users get it on without a migration.
  - **Preferences → Web Search** gets a switch at the top: "Search the web by default", with the line "New chats start with web search on. Use the globe button in the chat input to turn it off for one chat." It saves on change (D3). Without a key, the switch is off and disabled, with the line "Add a key to use this." The layout copies the fallback switch (`WebSearchSettings.tsx:163` to `:181`).
  - The globe button shows only when a provider has a key (`getPrimaryWebSearchProvider(prefs) !== undefined`). It shows as soon as you add a key, because the chat input reads the preferences on each render (`ChatContainer.tsx:199`).
  - New chats and chats that you open from the sidebar start with the preference. The globe button changes only the open chat (D10). The reset happens on **New chat** and when you select a chat, not when the first message creates the chat (`useBedrockChat.ts:147`), so a choice made before the first message stays.
  - The request sends search only when it is on and a key is set.
  - Ollama models without the "tools" capability get no tools, and the globe and MCP buttons say "This model cannot use tools" (D11). Ollama rejects tools for these models with "… does not support tools". Check this with a model that has no tool support during the testing. Other providers do not report tool support, so their behaviour stays the same.
- **Trade-offs:**
  - The model can search in every chat, so some replies use more tokens and more search quota. The model still decides when to search.
  - Without a key, nothing in the chat input says that web search exists. The Web Search tab in Preferences and the README tell how to add a key.
- **Done in PR 8:**
  - `resolveWebSearch(prefs, override, toolsSupported)` in `src/utils/webSearch.ts` gives the state of the open chat: the globe shows when a key is set, it is on from the user's choice for the chat or else the preference, and the request sends search only when the model can use tools. AppShell keeps the choice for the chat (`null` follows the preference). New chat and opening a chat from the sidebar reset it. The first message of a new chat does not.
  - The state comes from the live preferences, so the first key, a removed key, or a change of the default shows at once.
  - The Preferences switch "Search the web by default" is at the top of the Web Search tab. It saves on change. Without a key it is off and disabled, with "Add a key to use this."
  - `supportsTools` comes from the Ollama capabilities, and is not set when Ollama reports no capabilities. A model with `supportsTools: false` gets no search, no key headers, and no MCP servers. The globe and MCP buttons stay focusable, show "This model cannot use tools", and keep the choice for the next model. Ollama does not run on the test host, so this path has unit tests only.
  - Tested in Chromium with Claude Haiku 5.5 · Global and a fake Brave key: the request has `enableWebSearch: true` and the key headers in a new chat, `false` after the globe turns it off, and `false` after the key is removed. The toolbar stays on one row at 1440 and 1024 px.
  - A search that fails on every provider counts as failed in the work row: "2 searches · 2 failed" with the rejected key, also after a reload (see [Found during the planning](#found-during-the-planning)).

### 18. Rename a chat from the header

- **Categories:** Core flows. **Effort:** S.
- **Problem:** The title in the header is plain text. To rename a chat, you must find it in the sidebar, open its "…" menu, and click **Rename**. With the sidebar closed or on a phone, you must open the sidebar first. Most titles need a rename, because the app makes them from the first 47 characters of the first message and cuts the last word.
- **Evidence:**
  - `AppLayout.tsx:124` to `:126`: the header title is an `h1` with text only.
  - `ConversationList.tsx:143` to `:154` and `:255` to `:270`: the only rename is in the sidebar row menu.
  - `conversationService.ts:23` to `:27` and `:133`: the title is the first message, cut at 47 characters, plus "...". Screenshot 3 shows "Find out everything about the company trajector...".
  - `conversationService.ts:80` to `:87`: an update sets `updatedAt` to now. The sidebar sorts and groups by `updatedAt` (`useConversations.ts:27`), so a rename moves an old chat to Today.
  - `AppShell.tsx:71` to `:76`: the header reads the title with a live query, so it changes when the title changes in IndexedDB.
- **Fix** (as recommended in D12 and D13):
  - Click the title to edit it in place. A 16 px pencil button after the title shows on hover and focus, and always on touch screens. Its name is "Rename chat", so keyboard and screen reader users can start a rename too. The `h1` keeps the title as its text.
  - The field uses the size and weight of the title (15 px, 600) and fills the free space in the header.
  - **Enter** or a click outside saves. **Esc** cancels. An empty title is not saved, and the old title stays. Text in an IME composition does not save early (the same guard as `ConversationList.tsx:263`).
  - The header and the sidebar use the same save rules, from one shared helper.
  - A new chat ("New conversation") has no stored chat, so its title cannot be edited until the first message.
  - A rename does not change `updatedAt` (D13), so the chat stays in its date group.
- **Trade-offs:** A click on the title no longer selects its text for a copy. The text in the edit field can still be selected and copied.
- **Done in PR 9:**
  - `normalizeTitle` (`src/utils/conversationTitle.ts`) trims the text and makes each run of white space one space. An empty result is not saved. `EditableTitleInput` (`src/components/ui/editable-title-input.tsx`) holds the edit rules for the header and the sidebar: Enter and blur save, Esc cancels, the IME guard, and no write when the title does not change.
  - `conversationService.rename` writes only the title. `update()` still sets `updatedAt` for its other callers.
  - The `h1` has the click handler, and the "Rename chat" pencil button is the keyboard and screen reader path. The ESLint config has no a11y rules that reject this. The pencil shows on hover and focus, and always on touch screens (44 px below `md`).
  - After Enter or Esc, focus goes back to the pencil. After a click outside, focus stays where you clicked.
  - Tested in Chromium: a chat from 20 days ago keeps its group and its `updatedAt` after a rename in the header and in the sidebar, and the name stays after a reload. A 170-character title does not make the page scroll sideways at 390 px.

### 19. Current provider first in the model picker

- **Categories:** Core flows. **Effort:** S.
- **Problem:** With a Kiro model selected, the model picker still opens with "Amazon Bedrock · 92 models" at the top. The Kiro models are far down the list, so you must scroll to find them. The same happens for any provider that is not first in the fixed order.
- **Evidence:**
  - `useAllModels.ts:123` to `:152`: the app loads the providers in a fixed order (Bedrock, Mantle, API-key providers, LM Studio, Ollama, Kiro), and the picker shows them in that order.
  - `ModelSelectorButton.tsx:94` and `:147`: the groups show in the order of `providers`, with no regard for the selected model or the default provider.
- **Fix:**
  - `currentProviderFirst` (`src/utils/modelOrder.ts`) puts the group of the current provider first and keeps the order of the other groups. The current provider is the provider of the selected model. With no model selected, it is the default provider from **Preferences → Providers**.
  - A search keeps the order: cmdk 1.1.1 sorts the items inside a group, not the groups. A test guards this. The picker still opens on its first row.
  - Groups that show "Checking…" or an error hint stay below the groups with models.
  - `AppShell` passes `preferredProvider` to the picker through `ChatContainer`.
- **Done in this PR:** unit tests for the order function and for the picker (selected model, default provider, no provider, and a search where another group matches better).

### 20. Replies keep running in their own chat

- **Categories:** Core flows. **Effort:** M.
- **Problem:** A reply that streams moves into the new chat when you click **New chat**. The new chat shows Stop and the reply text of the other chat. A click on a different chat overwrites the last reply of that chat. You cannot start a second chat while a reply runs, and nothing tells you when a reply ends in a chat that you do not look at.
- **Evidence:**
  - `useBedrockChat.ts` kept one `messages`, one `status`, one `wasInterrupted`, one `streamStatus`, and one `abortControllerRef` for the whole view. The stream loop wrote into "the chat that is shown" (`flushAssistantMessage`, then `setMessages(prev => …)`).
  - **New chat** calls `clearMessages` and does not stop the run, so the next frame pushed the reply of chat A into the empty chat.
  - The database writes were already right: they used the id that the run captured. Only the view state was shared.
  - `ConversationList.tsx` deleted a chat with no stop, so a running reply could write into a deleted chat.
- **Fix:**
  - `src/utils/replyStore.ts` holds the state of each running reply by chat id, at module level, and the hook reads it with `useSyncExternalStore` (`src/hooks/useReplies.ts`). A run writes only through its own handle, and the writes of an older run are ignored. The store has no DOM code and has its own tests.
  - The view shows only the reply of the open chat. **Stop** and the send guard use the open chat only, so each chat can have one running reply.
  - The sidebar row of a running chat says "Replying…" with a spinner that stops for reduced motion, or "Waiting for your answer" for a Kiro question.
  - A toast ("Reply ready", "Reply failed") shows for every reply that ends, also in the open chat, with the chat title. "Kiro is waiting for your answer" shows only when the chat is not on screen, because the work row of the open chat already shows Kiro's buttons. The **Open** action shows only when the chat is not on screen. A stopped reply shows no toast. One constant, `REPLY_NOTICE_RULES` in `src/utils/replyNotice.ts`, holds the rules.
  - **Delete** stops the running reply first, then deletes the chat.
  - A reload or a closed page still stops the running replies.
- **Not changed:** the app still does not save the partial text of a stopped reply. This was so before this item.
- **Done in this PR:** unit tests for the store and the toast rules, hook tests (switch chats, come back, two chats at once, New chat, Stop, Kiro question), sidebar tests (words, delete order), and a check with real Bedrock and Kiro replies in headless Chromium at 1440 and 390 px, light and dark.

### 21. Totals of the whole chat in the context popover

- **Categories:** Context and cost. **Effort:** M.
- **Problem:** A chat can mix models, for example Kiro and Amazon Bedrock. The context popover follows the current model: it shows only the Kiro credits, or only the Bedrock tokens and cost, never the totals of the whole chat. In some cases the ring does not show at all, also for a saved chat with replies.
- **Evidence (origin/main 4e05995):**
  - `ChatContainer.tsx:717`: with no selected model, `contextLimits` is null and the indicator does not render.
  - `ContextIndicator.tsx:61`: for a model that is not Kiro, the ring is hidden when the last reply came from Kiro, because Kiro replies have no tokens (`contextTokens` is 0).
  - `ContextIndicator.tsx:104` and `chatUsage.ts:66`: for a Kiro model, the ring is hidden when the last reply came from another model (`contextPercent` is undefined).
  - `chatUsage.ts:63`: the fill took the tokens of the last reply of any model and divided them by the window of the current model.
  - `ContextIndicator.tsx:66` and `:103`: two popovers, one with tokens and cost, one with credits.
- **Fix:**
  - `summarizeChatUsage(messages, current)` calculates the sum of all replies. Kiro credits stay apart from tokens and dollars. `tokenReplies` counts the replies that bill tokens, and `allLocal` looks only at them, so a chat of local and Kiro replies shows **Free**.
  - The fill is known only when the last reply with usage came from the current model (same provider and model ID). Otherwise the chip shows a chart icon with the name "Usage of this chat". After a reply from a different model, the popover says "Context use shows after the next reply from this model." With no model selected, it says "Select a model to see the context use." This is the option that is never wrong: the next request sends the whole chat to the current model, with its own tokenizer and window.
  - Cost rule: the sum over the replies that have a price. Local replies count as 0. No priced reply: "No price data". Some unpriced: the known sum and "N replies have no price data". If the known sum is $0, because only local replies have a price, "No price data", not "$0.00".
  - One popover: the fill or the note, "This chat" tokens, the Kiro account line (K8) when the current model is Kiro or the chat has Kiro replies, "Cost", and "Credits in this chat".
  - `ChatContainer` shows the indicator when the chat has one or more replies with usage.
- **Tests:** the summing (mixed Kiro and Bedrock, all local, local and Kiro, some unpriced, no replies, a chat read back from the database, the fill only for the current model) and the component and the chat (both totals in a mixed chat, the ring for a saved chat with a different current model, the ring with no model).

### Found during the planning

- **Stale text in Saved Prompts.** The empty Saved Prompts dialog says "click the bookmark button to save it" (`ViewPromptsModal.tsx:192`, screenshot 2). PR 4 moved that button into the **+** menu as "Save as prompt". PR 6 changes the text to "Type a prompt in the chat input, click +, and then click Save as prompt."
- **The sidebar shows only 50 chats.** `useConversations` loads the 50 newest chats (`useConversations.ts:20`), and the sidebar uses that default (`ConversationList.tsx:95`). Older chats do not show, and **Search chats** does not find them. PR 7 loads all active chats. A chat row holds no messages, so the list stays small.
- **Titles cut in the middle of a word** (`conversationService.ts:26`). Plan 2 does not change this. A later item can cut at a space, or ask the model for a short title.
- **The navigation sheet stays open after you select a chat (PR 9 testing).** Below 1024 px, a click on a chat in the sheet opens the chat but does not close the sheet. This was so before Plan 2. Not in PR 9.
- **A search that fails on all providers did not say "failed" (PR 8 testing).** With a key that the provider rejects, the work row said "2 searches" and nothing about the failure. The search tool returns the errors as its output (`server/web-search.ts:131`, `error` field) instead of sending `tool-error`, so the step kept the status `success`, and `workSummary.ts:63` counted only steps with the status `error`. Each step already said "Failed" (`tool-call.tsx:40`). Fixed in PR 8: `isToolCallFailed` in `src/utils/toolResults.ts` holds the rule, and the summary and the step both use it.
- **The toast time is the normal time (item 20 testing).** The "Kiro is waiting for your answer" toast goes away after about 4 s. A busy page, for example while you open the navigation sheet at 390 px, can hide it before you click. The question stays open, and the sidebar row still says "Waiting for your answer". A later item can keep this toast until you act.
- **Reply text from two model calls runs together (PR 8 testing).** When the model writes text, calls a tool, and writes again, the two texts join with no space, for example "…a different query.I couldn't find…". PR 8 does not change how reply text is joined. Not fixed.

### Delivery plan for Plan 2

| PR | Branch | Items | Waits on |
|---|---|---|---|
| 6 | `feat/composer-comfort` | 15, stale Saved Prompts text | D6 |
| 7 | `feat/sidebar-groups` | 16, the 50-chat limit | D7, D8, D9 |
| 8 | `feat/web-search-default` | 17 | D10, D11, and PR 6 merged (both change the chat input toolbar in `ChatContainer.tsx`) |
| 9 | `feat/rename-title` | 18 | D12, D13, and PR 7 merged (both change the rename code in `ConversationList.tsx`) |

Merge order: 6, 7, 8, 9. PRs 6 and 7 can start at the same time. PRs 6 and 7 are merged (#70 and #71). PR 9 is stacked on PR 8: its branch starts from `feat/web-search-default`, and its PR targets that branch until PR 8 merges. Each PR updates `README.md` and `docs/CHANGELOG.md` where the behaviour changes: PR 7 for the groups ("Find a chat"), PR 8 for "Web search", and PR 9 for a new "Rename a chat" part.

Each PR is tested as the guidelines say: headless Chromium with a real Bedrock reply, light and dark mode, 1440, 1024, and 390 px, no sideways scroll, and a reload. PR 7 also checks the contrast of the row time on the sidebar in all eight theme variants (muted text on the sidebar is 4.92:1 or more today).

## Plan 3: MCP servers

Plan 3 fixes MCP server bugs that users reported after release 1.3.0 and adds two features: local servers that are standalone programs, and an import from other tools. It is not part of the Kiro provider work.

Evidence comes from `main` at `abb6c12`, `@ai-sdk/mcp` 2.0.91, two screenshots of 2026-11-26 (the MCP popover with "Attempted to send a request from a closed client", and a new local server in Preferences), probe scripts that use the app's own transport class and environment, and calls to the real `POST /api/bedrock-aisdk/mcp-status` route of a dev server on port 5174.

### 22. MCP servers that fail say why, and recover

- **Categories:** Core flows. **Effort:** M.
- **Problem:** A local server that runs with `npx` shows "Attempted to send a request from a closed client" and 0 tools. The message does not tell the user what is wrong or what to do.
- **What the reproduction found:**
  - The app starts `npx` correctly. The probe ran `npx -y @praveenc/llmstxt-doc-search` with the app's environment. The child stopped after 355 ms with exit code 1 and `npm error code E401` ("your authentication token seems to be invalid"). The npm configuration of the test host uses a private registry, and its token had expired. The same command fails in a terminal.
  - With `npm_config_registry=https://registry.npmjs.org/` in the server's environment variables, the same server connects through the real route in 1.8 to 4.2 s with 7 tools. `@modelcontextprotocol/server-filesystem` and `@playwright/mcp` connect too.
  - So the defect is in the app's error handling, not in the start of `npx`. Four defects hide the cause or make a server stay broken.
- **Evidence:**
  - **The child's error output goes to the terminal only.** `mcp-manager.ts:294` to `:299` makes the transport with no `stderr` option. The SDK then uses `stderr: 'inherit'` (`@ai-sdk/mcp` `dist/mcp-stdio/index.js:343` to `:349`). The npm error shows in the terminal of `npm run dev`. The UI gets only the SDK's message (`dist/index.js:2659`). A quoted argument (`"-y"`) fails in the same way: npm says `EINVALIDTAGNAME` in the terminal, and the UI says "closed client".
  - **A server that stops stays broken.** `getOrCreateClient` (`mcp-manager.ts:328` to `:347`) returns the cached client when the config is the same (`:332`), with no check that its process still runs. Through the real route: a check connected with 7 tools, the server process was stopped, and each check after that said "Attempted to send a request from a closed client". Only a config change or a restart of the dev server fixes it.
  - **A timeout leaves the process running.** `createClientWithTimeout` (`mcp-manager.ts:268` to `:269`) uses `Promise.race`. When the timer wins, nothing closes the transport. The probe: the child still ran after the timeout. The SDK has `initializationOptions: { timeout }`, which closes the transport when the start fails (`dist/index.js:2433` to `:2480`).
  - **Two requests can start two processes.** `getOrCreateClient` has no record of a start that is still running, so a status check and a chat at the same time each start the server. The second one replaces the cache entry, and the first process is never closed (code reading).
  - **The app starts half-typed servers.** Each save of Preferences (700 ms after typing stops, `PreferencesDialog.tsx:59`) fires `PREFERENCES_CHANGED_EVENT` (`preferences.ts:87` to `:91`). The MCP button in the chat input then checks every enabled server again (`MCPToolsIndicator.tsx:62` to `:73` and `:83` to `:90`). A new config hash closes the old client and starts a new one. So while you type `@praveenc/llmstxt-doc-search`, the app can run `npx -y @praveenc/llm`, which downloads and runs whatever package has that name. The browser sends every enabled server, also one with no command (`MCPToolsIndicator.tsx:90`, `useBedrockChat.ts:378` to `:379`).
- **Fix** (D14 (b) and (c)):
  - Keep the last 4 KB of each child's error output (`stderr: 'pipe'`), and still copy it to the terminal with the server name in front. When a start fails, the error says what happened and shows the last 6 lines, cut to 400 characters. For example: "The server stopped before it answered (exit code 1): npm error code E401 Unable to authenticate, your authentication token seems to be invalid."
  - When a server process stops, remove its client from the cache. The next check or chat starts it again. The app does not restart it by itself, so a broken server cannot loop.
  - Use the SDK's `initializationOptions.timeout` instead of `Promise.race`, so a timeout closes the process. The error says "The server did not answer in 15 s" and shows the last output.
  - Keep one start for each server. A second request waits for the start that runs.
  - The browser sends only servers that pass `validateMCPServerConfig`, in the check and in the chat. The MCP button checks the servers when the page loads, when Preferences closes, and when you open its popover, not after each save.
  - Each server in **Preferences → MCP Servers** has a **Check** button at the end of its form. It starts the server (or connects to a remote server) and shows the result under the button: "Connected · 7 tools" or the error. The button is off while the form has an error. A change of the command, the arguments, the environment, the URL, or the headers clears the result. Remote servers get the button too, because the same route checks them.
  - The SEC-11 error (`mcp-manager.ts:205`) shows the server name and id only, not the config with its environment values and headers.
  - README, Troubleshooting: a new part "An MCP server shows an error". It explains `E401` (log in to your npm registry again, or set `npm_config_registry` for that server) and where to read the full output.
- **Trade-offs:** The status popover can show text that the server wrote to its error output. Only the app's own pages can read it (SEC-13). A server that writes a secret to its error output shows it in the popover, as it already does in the terminal.
- **Done in M1:**
  - The error texts: "The server stopped before it answered (exit code N): …", "… It wrote no error output.", "Command not found: x", "The server did not answer in 15 s.", and "The server did not list its tools in 15 s." The output part is the last 6 lines of stderr without ANSI codes, cut to 400 characters.
  - The starts are keyed by server id and config hash. Each cached client has a lease count: a status check holds it while it lists the tools, and a chat holds it until its cleanup runs, so a cleanup never closes a client that another request uses. A listing on a client that another path closed starts once more.
  - A status check closes a disabled server after it lists its tools. The MCP popover sends `closeOthers: true` with the full list. When Preferences closes and no server is left, it sends an empty list, so the server closes the last deleted server.
  - The **Check** button (`MCPServerCheck.tsx`) uses `aria-disabled`, so it keeps the focus while it runs and while the form has an error. The result is in an `aria-live` region and wraps.
  - The error line in the MCP popover wraps (`break-words`).
  - Tested with the real dev server on port 5174: `npx -y @praveenc/llmstxt-doc-search` with the host's npm settings shows the npm error, with `npm_config_registry` it connects with 7 tools, after its process is stopped the next check connects with a new process, a config change and a check of a disabled server and an empty `closeOthers` check leave no `npm exec` process, a server that never answers fails after 15 s and its process is gone, and a command that is not on `PATH` says "Command not found". In headless Chromium (light and dark, 1440, 1024, and 390 px), typing in the form made no check, closing Preferences made one, the popover made one, and **Check** showed "Connected · 7 tools". React StrictMode runs the page-load check twice in dev; the two calls share one start.

### 23. Clearer Add MCP server form

- **Categories:** Core flows, Accessibility. **Effort:** S.
- **Problem:** The form for a new local server starts with text that you must delete, does not say which commands to use, and does not say how to type arguments and environment values.
- **Evidence:**
  - **2a, Name.** `createDefaultStdioConfig` sets the name "New MCP Server" (`src/types/mcp.ts:71`). It is a value, not a placeholder, so a click in the field does not clear it. The field's placeholder "My MCP Server" (`MCPServerSettings.tsx:434`) never shows. The remote forms do the same ("New Remote Server", "New SSE Server").
  - **2a, also.** A new server opens closed (`MCPServerSettings.tsx:281`, `useState(false)`), so after **Local** you must open it before you can type.
  - **2b, Command.** The placeholder is "node, python, npx, etc." (`MCPServerSettings.tsx:551`). It does not name `uvx`. The help text is "The command to run the MCP server process" (`:556`).
  - **2c, Arguments.** Each field has the placeholder "Argument N" (`:241`) and no help text (`:562`). The SDK starts the child with no shell (`dist/mcp-stdio/index.js:350`, `shell: false`), so the app passes each field as it is: quotes become part of the argument, and `~` and `$HOME` are not expanded. Through the real route, `"-y"` made npm fail with `EINVALIDTAGNAME`.
  - **2d, Environment variables.** The placeholders are "VARIABLE_NAME" and "value" (`:575` to `:576`), with no help text (`:569`). Values have the same rules: no quotes, no `$VAR`, no `~`.
- **Fix** (D16 (a)):
  - New servers start with an empty name. The header shows "New local server" or "New remote server" in muted text until the name has text (today "Untitled", `:378`). The name placeholder is an example, `my-server`. The error "Server name is required" shows after you leave the field, as today for new servers (`:649`, `:665`).
  - A new server opens, and the Name field gets the focus.
  - Command placeholder: "npx, uvx, node, python, etc." Help text: "The program that starts the server. Put its arguments in the fields below."
  - Help text under **Arguments**: "One argument in each field, with no quotes. The app does not use a shell, so it passes each field as you type it." The first two placeholders are `-y` and `package-name`, then "Argument N".
  - Help text under **Environment Variables**: "One variable in each row, with no quotes. The app does not expand `$VAR` or `~`: type the full value." Placeholders: `NAME` and `value`.
  - A field whose text starts and ends with the same quote shows a warning under it: "The quotes are part of this value. Remove them unless the server needs them." The value still saves as you typed it.
- **Trade-offs:** The help text makes the local form about two lines taller.
- **Done in M2:**
  - `createDefaultStdioConfig`, `createDefaultHTTPConfig`, and `createDefaultSSEConfig` start with an empty name. A transport change keeps the name, also an empty one. Saved servers keep their names.
  - A new server opens, and the Name field gets the focus once, when the form mounts. A collapse and an expand later do not move the focus. Saved servers start closed, as before.
  - The help text under **Arguments** and **Environment Variables** is linked to each field with `aria-describedby`, so a screen reader reads it with the field. The headers editor has no help text and no quote warning, because its values are password fields.
  - `hasOuterQuotes` (`src/utils/mcpFieldHints.ts`) holds the quote rule: two or more characters, and the same `"` or `'` at both ends after a trim. The warning uses `text-status-warn`, an icon, and words, and the value saves as typed.
  - The warning is `text-xs`, the size of the field errors. The help text stays `text-[10px]`, as the other help text of this form.

### 24. Local servers that are standalone programs

- **Categories:** Core flows. **Effort:** M.
- **Problem:** Many MCP servers are one program that you start by its name or its path, for example `github-mcp-server`. The app refuses them, so you cannot add them.
- **Evidence:**
  - `mcp-manager.ts:38` to `:49` and `:68`: only `node`, `npx`, `python`, `python3`, `uvx`, `uv`, `docker`, `deno`, `bun`, and `bunx` can start. `mcp-manager.ts:62`: a command with `/` is refused.
  - Through the real route, a standalone server program on the test host was refused by name ("is not in the allowlist") and by full path ("Command paths are not allowed"). The probe started the same program with the app's transport and environment, by name and by full path: it connected in 1.1 to 1.3 s with 38 tools. So the allowlist is the only block.
  - A Kiro config on the test host has 16 servers: 6 programs by name, 3 programs by full path, 5 that use `uv`, `uvx`, or `npx`, and 2 remote servers. A Pi config has 12 servers: 6 programs, 5 with `uv`, `uvx`, or `npx`, and 1 remote server. Today the app can run 7 of the 16 and 6 of the 12.
  - The allowlist does not stop other code today. `npx -y <package>`, `uvx <package>`, and `docker run <image>` run any code. And the user's environment variables replace the safe ones (`mcp-manager.ts:297`, `{ ...getSafeEnv(), ...stdioConfig.env }`): the probe set `PATH` in a server's environment, and the command `npx` started a different program named `npx`. The checks that hold are SEC-13 (only the app's own pages can call the route), the loopback bind, and no shell.
- **Fix** (D15 (a)):
  - A command can be a name that the server finds on `PATH`, or a full path that starts with `/` or `~/` (the server expands `~/`). A relative path (`./server`, `bin/server`) is refused, because it depends on the folder where the dev server started.
  - Before the start, the server finds the program on the same `PATH` that the child gets. The file must exist, be a regular file after links, and be executable. If not, the error says "Command not found: x" or "x is not a program".
  - Unchanged: no shell, the shell-character check on arguments, and the safe environment (SEC-02).
  - The form: command placeholder "npx, uvx, or the name or path of a program", and help text that says so.
  - SECURITY-LEARNINGS: SEC-01 is updated, and a new SEC entry records why the allowlist goes.
  - README: the "For safety" paragraph of "MCP servers" changes.
- **Trade-offs:** Anyone who can open the app can start any program on the host as the user. That is true today through `npx` and `uvx`, so the new risk is small. Share the app only through an authenticated tunnel (SEC-13).

### 25. Import MCP servers from other tools

- **Categories:** Core flows. **Effort:** L.
- **Problem:** Users already have MCP servers in other tools. They must type each server again in the app.
- **Evidence:**
  - On the test host: Kiro `~/.kiro/settings/mcp.json` (16 servers), Pi `~/.pi/agent/mcp.json` (12), Claude Code `~/.claude.json` (6 in `mcpServers`), and Codex `~/.codex/config.toml` (5, in TOML). Many servers are in more than one file under the same name.
  - The JSON files use one shape: `mcpServers: { <name>: { command, args, env } }` for a local server, and `{ type: "http", url, headers }` or `{ url }` for a remote one. Kiro adds `disabled`, `autoApprove`, `timeout`, and `transport`. Pi adds `toolExposure` and `exposure`. Claude Code adds `type: "stdio"`.
  - One Kiro environment value uses `${…}`. The app passes values as text (item 23), so that value would not work as it is.
  - The app keeps MCP servers in the browser (`preferences.ts:34`). Only the server can read files on the host.
- **Fix** (D17 (a), D18 (a), D19 (a)):
  - A new server file, `server/mcp-import.ts`, reads a fixed list of files in the user's home folder (D17). The browser never sends a path. The server reads at most 4 MB of each file and skips a file that it cannot read or parse.
  - `POST /api/mcp/import/scan` returns, for each file: the tool, the file as `~/…`, and each server with its name, transport, command, arguments, and the names of its environment variables and headers. It returns no environment values and no header values.
  - `POST /api/mcp/import/read` with the keys of the selected servers reads the files again and returns those servers in the app's own shape, with their values.
  - `src/utils/mcpImport.ts` maps one entry to `MCPServerConfig`, and has no DOM or Node imports. It drops the fields that the app does not use (`autoApprove`, `timeout`, `toolExposure`, `exposure`).
  - The list groups the same server (name, command, and arguments) from several files into one row: "Found in Kiro and Pi". A server that the app already has (same command and arguments, or same URL) shows "Already added" and is not selected. A different server with a name that the app already uses gets the tool name after it, for example "slack (Pi)".
  - A server that the app cannot run shows the reason and has no checkbox: a relative command, an argument with shell characters, or a remote URL that SEC-03 blocks.
  - A value with `${…}` shows a note: "1 value uses ${…}. The app passes it as text. Type the real value after the import."
  - Imported servers are off (D18). You turn on the ones that you want.
  - In **Preferences → MCP Servers**, a line at the top says, for example, "12 servers in Kiro and Pi are not in this app" with **Import** and **Not now** (D19). The tab checks the files when it opens. **Not now** hides the line until a new server shows up in the files. **Import** opens the list in the tab, with a checkbox for each server, grouped by tool, and **Import N servers** and **Cancel**. The empty tab shows the same line in its box.
  - A new SEC entry: fixed files only, a read limit, values only for the servers that you select, and `POST` routes behind the same-origin guard.
  - README: a new part "Import servers from other tools" under "MCP servers".
- **Trade-offs:** Imported values (API keys, tokens) are kept in the browser, as values that you type. The import reads files only when the tab opens and when you import. It does not follow changes in the other tools.

### Decisions for Plan 3

#### D14: When the app checks a server

Decided: (b) and (c).

A check starts each enabled local server and asks for its tools.

- **(a)** As today: after each save of Preferences (700 ms after typing stops), for every enabled server, also one that you are still typing.
- **(b)** When Preferences closes and when you open the MCP popover in the chat input, for complete servers only. **Recommended**: the app never starts a half-typed command, and the popover still shows the state.
- **(c)** As (b), and a **Check** button on each local server in Preferences that shows the result under the server.

#### D15: Which commands a local server can use

Decided: (a).

- **(a)** Any program: a name on `PATH` or a full path (`/` or `~/`). No relative paths. **Recommended**: the runners already run any code (item 24), and the checks that hold (SEC-13, loopback, no shell) stay.
- **(b)** The runners, and programs that you add to a file on the host (`~/.local-llm-ui/mcp-commands.json`). The browser cannot change the file. Each new program needs a change of the file by hand.
- **(c)** The runners, and full paths in the home folder only.

#### D16: Quotes in arguments and values

Decided: (a).

- **(a)** Help text, and a warning under a field whose text starts and ends with the same quote. The value saves as typed. **Recommended**: no silent change, and the user learns the rule.
- **(b)** Help text, and the app removes one pair of outer quotes when it saves.
- **(c)** Help text only.

#### D17: Which files the import reads

Decided: (a).

- **(a)** The JSON files with `mcpServers` in the home folder: Kiro, Pi, Claude Code (user servers only, not the servers of each project), and Cursor, Claude Desktop, Gemini CLI, and Windsurf when their file exists. Nothing in `~/.aws`. **Recommended**: one shape, no new dependency. The paths of the four tools that are not on the test host are checked in their docs during the work.
- **(b)** As (a), and Codex (`~/.codex/config.toml`). This needs a TOML parser as a new dependency.
- **(c)** Kiro and Pi only.

#### D18: Imported servers on or off

Decided: (a).

- **(a)** Off. **Recommended**: the Kiro and Pi files on the test host hold about 20 different servers. All on at once start about 20 processes on each check and send all their tools to the model with each message (one server alone has 38 tools).
- **(b)** As in the source file: on, unless the file says `disabled: true`.
- **(c)** On.

#### D19: Where the import shows

Decided: (a).

- **(a)** A line at the top of the MCP Servers tab when the files have servers that the app does not have, with **Import** and **Not now**, and the list in the tab. **Recommended**: the app finds the servers by itself, and the list does not open a second dialog over Preferences.
- **(b)** An **Import** button next to **Local** and **Remote** only. The files are read when you click it.
- **(c)** As (a), and a hint in the MCP popover of the chat input.

### Found during the planning

- **The SEC-11 error shows secrets.** `mcp-manager.ts:205` puts the first 200 characters of the config in the error, with its environment values and headers. The status route returns it, and the server log prints it. Fixed in M1.
- **Environment values are plain text.** Header values are password fields (`MCPServerSettings.tsx`, `valueType="password"`), but environment values are not (`:571` to `:577`). Environment variables often hold API keys. Not in the plan.
- **A server in the popover shows no output.** The popover shows `server.error` only (`MCPToolsIndicator.tsx:207`). With item 22 the error has the last lines of output, so no new UI is necessary.
- **Security errors echo values (M1 review).** `Argument contains shell metacharacters: '<arg>'` and `Invalid URL: '<url>'` (`mcp-manager.ts`, SEC-01 and SEC-03) show the value, which can hold a token. The status route returns them. M3 changes these checks, so M3 shows the argument number and the URL without its query and user info.
- **A wrapper that does not pass SIGTERM on (M1 review).** The SDK spawns with no process group, so the app signals only its direct child. `npx` passes SIGTERM on, and no process stays. A wrapper that does not pass it on leaves the server running. A test records this. A process-group kill needs an own spawn; it is not in the plan.
- **The npm error changes (M1 testing).** With the same expired registry token, npm first said `E401`, and later `EALLOWREMOTE` ("Fetching packages of type remote have been disabled") for the tarball URL in its cache. The app shows whichever npm writes.
- **Other tools keep servers running.** On the test host, Pi still runs the same `npx` server that it started before the npm token expired. A restart of Pi would fail in the same way. This is why the server works in Pi and not in the app.

### Delivery plan for Plan 3

| PR | Branch | Items | Waits on |
|---|---|---|---|
| M2 | `fix/mcp-server-form` | 23, and the Plan 3 text of this document | Nothing |
| M1 | `fix/mcp-npx-launch` | 22, the SEC-11 error text | M2 merged: M1 is stacked on M2 |
| M3 | `feat/mcp-standalone-commands` | 24 | M1 merged (M1 changes `mcp-manager.ts`, M2 changes the command field) |
| M4 | `feat/mcp-import` | 25 | M3 merged (M3 decides which imported servers can run) |

Merge order: M2, M1, M3, M4. M1 and M2 both change `MCPServerSettings.tsx` (the form and the **Check** button), `docs/CHANGELOG.md`, and the Progress table, so M1 is stacked on M2: its branch has M2 merged in, and its PR targets `fix/mcp-server-form` until M2 merges. Each PR has its own worktree under `local-llm-ui-wt/`, runs its dev server on port 5174 with the tunnel `local-llm-ui-bugs`, one PR at a time, and is trial-merged on the latest `main` before it opens, because `docs/CHANGELOG.md` also changes in the Kiro PRs. The SEC numbers are taken when each PR opens, because the Kiro PRs also add SEC entries.

Tests:

- M1: fake stdio servers in `server/__tests__/fixtures/` that stop with error output, stop after they connect, or never answer. Each needs a test that fails before the fix. With the real dev server: the `npx` server with the host's npm settings shows the E401 text, with `npm_config_registry` it connects, and after its process stops the next check connects again. No server process is left after a timeout.
- M2: component tests for the empty name, the focus, the help text, and the quote warning. Screenshots of the form in light and dark mode at 1440, 1024, and 390 px.
- M3: tests for a name on `PATH`, a full path, `~/`, a relative path, a missing file, a folder, and a file that is not executable. With the real dev server: a standalone server program by name and by full path.
- M4: tests of the mapping and the grouping with fixture files in a temporary home folder. Screenshots use the fixture home folder, so that no real server names show in the PR.
