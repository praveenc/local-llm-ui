# UI and UX improvements

Status: Plan 1 (items 1 to 14) is done. [Plan 2](#plan-2) (items 15 to 18) is approved and in progress. Last updated 2026-11-24. See [Progress](#progress) for the state of each item.

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
| 15 | A more comfortable chat input | 6 `feat/composer-comfort` ([#70](https://github.com/praveenc/local-llm-ui/pull/70)) | PR open |
| 16 | Sidebar groups with more structure | 7 `feat/sidebar-groups` ([#71](https://github.com/praveenc/local-llm-ui/pull/71)) | PR open |
| 17 | Web search on by default | 8 `feat/web-search-default` | Planned, after PR 6 |
| 18 | Rename a chat from the header | 9 `feat/rename-title` | Planned, after PR 7 |

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
| Context fill | The ring in the composer, with colour and words at 70% and 90% | When the chat has usage, also after a reload |
| Cost | The usage text of each reply, and the chat total in the context popover | Only when the price is known. Never in the sidebar. |
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

### Found during the planning

- **Stale text in Saved Prompts.** The empty Saved Prompts dialog says "click the bookmark button to save it" (`ViewPromptsModal.tsx:192`, screenshot 2). PR 4 moved that button into the **+** menu as "Save as prompt". PR 6 changes the text to "Type a prompt in the chat input, click +, and then click Save as prompt."
- **The sidebar shows only 50 chats.** `useConversations` loads the 50 newest chats (`useConversations.ts:20`), and the sidebar uses that default (`ConversationList.tsx:95`). Older chats do not show, and **Search chats** does not find them. PR 7 loads all active chats. A chat row holds no messages, so the list stays small.
- **Titles cut in the middle of a word** (`conversationService.ts:26`). Plan 2 does not change this. A later item can cut at a space, or ask the model for a short title.

### Delivery plan for Plan 2

| PR | Branch | Items | Waits on |
|---|---|---|---|
| 6 | `feat/composer-comfort` | 15, stale Saved Prompts text | D6 |
| 7 | `feat/sidebar-groups` | 16, the 50-chat limit | D7, D8, D9 |
| 8 | `feat/web-search-default` | 17 | D10, D11, and PR 6 merged (both change the chat input toolbar in `ChatContainer.tsx`) |
| 9 | `feat/rename-title` | 18 | D12, D13, and PR 7 merged (both change the rename code in `ConversationList.tsx`) |

Merge order: 6, 7, 8, 9. PRs 6 and 7 can start at the same time. Each PR updates `README.md` and `docs/CHANGELOG.md` where the behaviour changes: PR 7 for the groups ("Find a chat"), PR 8 for "Web search", and PR 9 for a new "Rename a chat" part.

Each PR is tested as the guidelines say: headless Chromium with a real Bedrock reply, light and dark mode, 1440, 1024, and 390 px, no sideways scroll, and a reload. PR 7 also checks the contrast of the row time on the sidebar in all eight theme variants (muted text on the sidebar is 4.92:1 or more today).
