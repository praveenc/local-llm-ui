# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 2026-11

#### Added

- Kiro sessions in the sidebar: a **Kiro sessions** section lists the sessions that you made in the terminal, with date groups, the folder name, a Last 7 days, Last 30 days, or All menu, and **Search chats**. A click imports the session with its messages, thinking, tool steps, and credits, and you can continue it in the app or in the terminal. Turn it on in the Kiro row in **Preferences → Providers** ([#83])
- Chat with Kiro: a **Kiro** group in the model picker with Kiro's models and credit rates, replies with thinking and tool steps, credits and the context percentage under each reply, a Max thinking level for Kiro models that have it, and Kiro's chat title. Each chat is a Kiro session in `~/.local-llm-ui/kiro`, and the app denies each tool question until the approval UI comes ([#80])
- Sign in to Kiro from **Preferences → Providers** with AWS Builder ID or IAM Identity Center. The app opens the sign-in page in a new tab and shows the code to compare. **Sign out** is in the same row ([#78])
- Kiro row in **Preferences → Providers**: when Kiro CLI 3 is installed, it shows the account, the sign-in method, and the version, or what to do when Kiro CLI is signed out or too old. **Check again** reads the state again ([#77])

#### Changed

- The Kiro code is split into a generic ACP layer (`server/acp/`) and a Kiro harness (`server/kiro/`), so another ACP harness can use the same layer later. Nothing changes in behaviour ([#81])

#### Fixed

- A web page on a different site could send requests to the `/api` routes: a form post could start a chat with your AWS credentials or API keys, or start an MCP server command. The routes now accept requests only from the app's own pages, and a request with a body must be JSON ([#76])

## [1.2.0] - 2026-11-24

PR numbers link to GitHub.

### 2026-11

#### Added

- Neutral color theme, now the default; Cosmic Night, Cobaltz, and Rosé Pine stay in the theme menu ([#59])
- First-run checklist: when no model is ready, the empty chat lists each provider's status and how to fix it, with a button that opens Preferences ([#59])
- A working local model is picked on first run, with a note saying so; a paid provider is never picked automatically ([#59])
- Model picker groups models by provider and shows each provider's status ([#59])
- Each provider is probed on its own, so fast providers list their models while a slow one shows "Checking..." ([#59])
- Retry and Change model buttons in the chat error alert ([#59])
- Keyboard: `/` focuses the chat input; Cmd+K (Ctrl+K) opens the model picker ([#59])
- Product mark in the sidebar and a favicon; the header shows the open conversation's title ([#59])
- Quote and Ask stays open on Esc or a click outside while it holds unsaved edits, with a "You have unsaved changes." line and a Discard button ([#60])
- Copying a message, code, or an error shows a "Copied" or "Copy failed" toast ([#61])
- System appearance, now the default: the app follows the OS light or dark setting and switches when it changes; the theme menu and Preferences offer System, Light, and Dark ([#62])
- A show and hide button on API key fields, so a pasted key can be checked ([#62])
- Each reply shows its tokens, time, and cost next to the rating buttons, also after a reload ([#63])
- The context indicator says "Near the limit" at 70% and "Almost full" at 90%; its card shows the tokens read from the prompt cache, the reasoning tokens, and the cost of the chat ([#63])
- One line above an answer says what the model did, for example "Thought 6 s · 2 searches · 7 sources · 1 fetch call"; while the reply streams it shows the step that runs now, and a click lists each step ([#65])
- Search and tool steps are saved with the reply, so they stay when you open the chat again ([#65])
- A new chat puts the chat input in the middle of the window, under "What can I help with?"; it moves to the bottom after the first message ([#67])
- Search chats: a filter at the top of the conversation list ([#67])
- A New chat button in the header ([#67])
- A line in the chat shows when the next reply comes from another model ([#67])
- Each chat in the conversation list shows the time of its last message, and a closed date group shows how many chats it has ([#71])
- The conversation list remembers which date groups are open, also after a reload ([#71])
- Rename the open chat from the header: click the title, or the pencil button next to it. Enter or a click outside saves, Esc cancels ([#73])
- UI and UX rules for contributors in `.kiro/steering/ui-ux-guidelines.md` ([#69])

#### Changed

- The conversation list groups chats by the calendar: Today, Yesterday, Previous 7 days, Previous 30 days, and then one group for each month. The group headings are larger and stay at the top of the list while you scroll ([#71])
- Text meets 4.5:1 contrast in every theme ([#59])
- Every theme colours links, the open conversation, and the send button with its own primary colour; status dots show ready, needs a fix, or checking. Neutral takes one teal accent ([#59], [#64])
- The chat input has a border and no shadow or gradient; disabled tools say why they are off ([#59])
- Glass and shimmer effects are gone; with reduced motion on, spinners turn slowly and movement stops, while colour and opacity fades still run ([#59])
- Below 1024 px the sidebar folds into a sheet; touch targets are 44 px below 768 px ([#59])
- Preferences has a fixed height, so the tabs stay in place ([#59])
- Images in replies are no longer loaded, so a reply cannot send chat text to another site; each shows as "[Image blocked]" with its description ([#60])
- Conversation titles in the sidebar are cut at the row width, not at 25 characters ([#60])
- The context usage card opens by click, tap, Enter, or Space, so it also works on touch screens ([#61])
- The header theme button switches to the opposite of what is shown; when that matches the OS, the app goes back to following the OS ([#62])
- The app uses the Inter and JetBrains Mono fonts on every system; they are bundled with the app ([#62])
- Scrollbars are the default width; the thumb keeps the theme's colour at 3:1 contrast ([#62])
- Claude prices are current (copied 2026-11-24) and cover Claude 4.6 to 5.5, the Haiku 5.5 long-prompt price, cache prices, and the Bedrock regional price; a model without a price shows "No price data", not $0.00, and local models show "Free" ([#63])
- Claude 4.6 and later models have a 1M-token context window in the context indicator, on every provider ([#63])
- Replies are easier to read: 15 px text with a 1.65 line height, paragraphs and lists at most 70 characters wide, list bullets outside the text, and headings, code, and tables sized from the reply text; the chat column is 768 px wide ([#64])
- Calmer surfaces: the user's messages, the avatar, inline code, and code blocks no longer take the theme tint; the chat input is closer to the page colour; Neutral body text is 15:1 instead of 18:1; dark themes use thinner font smoothing on macOS ([#64])
- README: the Neutral theme, the System appearance, and the bundled fonts ([#64])
- README: screenshots of the current UI, and the features and labels of this release ([#74])
- The Thinking chip and the tool cards are replaced by the work line; a search step lists the sites of its results, and an MCP step shows the text of its output, not JSON ([#65])
- The web search button says "Search" when it is on ([#65])
- The `motion` package is removed; nothing uses it any more ([#65])
- The model chip in the chat input shows a short name with the inference profile, for example "Claude Haiku 5.5 · Global"; the full name and the provider are in its tooltip ([#67])
- The sticky model badge above the chat, the model line under the product name, and the chat icon on each conversation are removed ([#67])
- Clear chat is removed from the chat input (it did the same as New chat); Save prompt moved into the + menu as "Save as prompt" ([#67])
- The chat input is as wide as the reply column (768 px) ([#67])
- Preferences saves each setting when you change it; typed values (API keys, avatar initials, MCP server fields) save when you stop typing, leave the field, push Enter, or close the dialog. The footer shows "Saved", and one Done button replaces Save and Cancel. Theme changes in Preferences show at once ([#68])
- If a change would remove the API key of the default provider, Preferences does not save it and shows "Not saved" until you select a different default provider ([#68])
- Message action icons (rating, copy, regenerate) are 16 px instead of 12 px ([#68])
- A long reply updates the screen at most once per frame while it streams ([#62])
- Web search is on in each new chat when a search key is set; the globe button turns it off for one chat, and **Search the web by default** in Preferences → Web Search turns the default off. Without a key, the globe button does not show ([#72])
- Ollama models that cannot use tools get no web search or MCP tools; the globe and MCP buttons say "This model cannot use tools" ([#72])
- The chat input is more comfortable: it shows three lines of text in a new chat and two lines in a chat with messages, with 12 px around the text and the toolbar and 4 px between the buttons. It grows to 40% of the window, at most 320 px, before it scrolls. When the chat input is narrower than 768 px, the Thinking button shows only its level ([#70])

#### Fixed

- The conversation list showed only the 50 newest chats, and Search chats did not find older ones; it now shows all chats ([#71])
- A rename moved the chat to Today; it now keeps the date of its last message ([#73])
- Icon buttons and the chat input have accessible names, and screen readers announce when a reply starts and ends ([#59])
- Scrollbar thumbs have 3:1 contrast in every theme and show no light track when macOS shows scroll bars always ([#59])
- Renaming a conversation with a Japanese, Chinese, or Korean input method no longer saves early when Enter confirms a candidate ([#59])
- Conversations in the sidebar open with Tab and Enter, and each options button is named after its conversation ([#60])
- Closing a dialog or sheet returns keyboard focus to what opened it; deleting a conversation moves focus to the next row ([#60])
- Skipped attachments are named with the reason, and the valid files in the same batch are still added ([#61])
- A file dropped outside the chat input no longer opens in the browser and loses the unsent message ([#61])
- Typing a header or variable name in the MCP server form no longer loses focus after each letter; fields, rows, and errors are labelled for screen readers ([#61])
- Pressing Enter in the Save Prompt name field saves the prompt, and an empty name shows its error on the field ([#61])
- The scroll-to-bottom button is named and keeps keyboard focus in the chat when it disappears ([#61])
- In dark mode, form controls, autofill, and the page background before it loads are dark too ([#62])
- Theme previews keep their colours in Windows High Contrast, and the selected theme is outlined ([#62])
- The model picker's search no longer runs under its close button ([#62])
- The app sends a Content Security Policy, a referrer policy, and frame protection, so other sites cannot embed it ([#62])
- The context indicator showed too much: it added up every reply, and each model call in a tool loop sends the whole chat again. It now shows the size of the last model call ([#63])
- Token usage and the context indicator came back empty after a reload or a model change; they now come from the usage stored with each reply ([#63])
- A tool that failed looked like it was still running; it now shows as failed with its error, and a tool that has no result when the reply ends is marked failed ([#65])
- MCP tools said "Searching..." while they ran; they now say "Running…" ([#65])
- A model search with a dot, for example "Haiku 5.5", found nothing ([#67])
- The scroll-to-bottom button covered the text of the chat; it now sits in a strip between the chat and the chat input ([#68])
- On narrow screens the chat input covered the end of the chat when its toolbar took more than one row; the chat now ends above the measured height of the input ([#68])
- A web search that failed on every provider, for example with a rejected key, was not counted as failed in the line above the answer; it now says, for example, "2 searches · 2 failed", also after a reload ([#72])
- The empty Saved Prompts list said to click a bookmark button that is gone; it now says to click + and then Save as prompt ([#70])
- A local (stdio) MCP server that needed more than 1 second to start could fail with "the initialize handshake is not accepted"; the app now waits for the `server/discover` answer, up to the 15 second connection timeout ([#66])
- The microphone button no longer pulses when reduced motion is on ([#68])

## [1.1.0] - 2026-11-12

PR numbers link to GitHub.

### 2026-11

#### Added

- Thumbs up and thumbs down ratings are stored with the message, so they stay after a reload; a second click removes the rating ([#55])
- Thinking effort menu for xAI Grok 4.6 and 4.7 on Bedrock, with Low, Medium, High, and XHigh ([#55])
- LM Studio chat goes through the AI SDK, so web search, MCP tools, and the tool loop work with LM Studio models ([#53])
- Content density setting: Compact uses less space in the chat and the sidebar ([#52])
- Avatar initials next to the user's messages ([#52])
- Save a prompt from the chat input with the bookmark button; insert a saved prompt into the chat input from the Saved Prompts dialog ([#50])
- Theme menu in the header: Cosmic Night, Cobaltz, and Rosé Pine, each in light and dark; code blocks follow the theme ([#44], [#46])
- Web search providers: Brave Search and Exa next to Tavily, with a primary provider and fallback order ([#43])
- Thinking effort selector (Off, Minimal, Low, Medium, High, XHigh) for Bedrock, Mantle, Anthropic, OpenRouter, Groq, and Ollama, with a default per provider in Preferences ([#42])
- Max tool steps setting for replies that use tools; the last step always writes an answer ([#42], [#43])
- Preferences redesigned: Providers, Web Search, MCP Servers, and Display tabs ([#41])
- Quote and Ask: select text in a reply, then send a question to the chat input or to a fork of the conversation ([#39])

#### Changed

- The app no longer sends `temperature` or `top_p`; newer models reject them, and all models use their own defaults ([#38], [#48])
- README rewritten for new users ([#47])
- New chats start with the model last picked in the chat input ([#40])
- `<think>` tag splitting for Ollama and LM Studio is one shared module ([#53])

#### Fixed

- Tool call cards are smaller, and MCP tool cards show the URL or path that the call used ([#56])
- Toasts show at the top center; before, they covered the buttons at the right of the chat input ([#55])
- Stream errors from the Anthropic, Ollama, and LM Studio proxies now show in the chat; before, the reply stopped with no message ([#49])
- A Bedrock error after the stream started no longer stops the dev server ([#45])
- LM Studio model list fallback now runs; Mantle region list has all 12 regions ([#49])

#### Removed

- The copy of the `ai-elements` agent skill in Git (129 files); `npx skills install` restores it from `skills-lock.json` ([#57])
- Optimize Prompt chain (no screen opened it), the `/api/bedrock/chat` handler, and `@aws-sdk/client-bedrock-runtime` ([#49])
- `APIService`, `checkConnection()` in all services, the LM Studio model loading endpoints, Cloudscape leftovers, and unused modules and packages ([#49])
- Style guide app (`src/styleguide-shadcn/`), unused shadcn primitives, and the beads tracker files ([#51])
- Dependency upgrades: AI SDK 7, React 19.3, Vite 8, TypeScript 6, Vitest 5 ([#37])

### 2026-03 and 2026-04

#### Added

- OpenRouter provider ([#36])
- TanStack Query for provider and model state ([#35])
- MCP servers: stdio, HTTP, and SSE transports, configured in Preferences; MCP tools status in the chat input ([#28], [#29])
- Active model badge above the conversation ([#27])
- Claude Code project setup: agents, hooks, and steering ([#32])

#### Fixed

- Security hardening for MCP servers: command allowlist, safe environment, SSRF checks, body size limits, CORS, token cap ([#30])
- Groq model list from the Groq API ([#31])
- Code block copy and download buttons ([#33]); Safari file upload button ([#34])

### 2025-12 and 2026-01

#### Added

- Anthropic provider through the AI SDK ([#26])
- Web search with Tavily ([#25])
- Groq and Cerebras providers through the AI SDK ([#16])
- Saved prompts with Dexie persistence ([#19])
- Amazon Bedrock and Bedrock Mantle providers; file upload for Bedrock documents and images
- Conversation history in IndexedDB with fork and regenerate

#### Changed

- Ollama chat through the AI SDK provider ([#24])
- Chat UI rebuilt on AI Elements (message, prompt input, reasoning, context) ([#23])
- Cloudscape Design System replaced by shadcn/ui with Radix UI and Tailwind CSS 4 ([#21])

#### Fixed

- Chat input overflow ([#22])

## [1.0.0] - 2025-01-31

### Added

- Initial release of Local LLM UI
- Support for Ollama AI provider
- Support for LM Studio AI provider
- Real-time streaming chat responses
- Model selection and configuration
- Adjustable parameters (temperature, top-p, max tokens)
- New chat functionality (clear current conversation)
- Modern UI built with AWS Cloudscape Design System
- Responsive design for desktop and mobile
- Dark/Light mode support through Cloudscape
- Connection status indicators
- Model settings sidebar
- Help panel with connection information

### Features

- **Provider Support**: Ollama (port 11434) and LM Studio (port 1234)
- **Model Configuration**: Temperature, Top-P, and Max Tokens controls
- **Chat Management**: Create new chats and clear current conversation
- **Real-time Streaming**: See AI responses as they're generated
- **Beautiful UI**: Professional interface using Cloudscape Design System

### Technical

- Built with React 19, TypeScript, and Vite
- Uses AWS Cloudscape Design System for UI components
- Vite proxy for local AI service connections
- TypeScript for type safety
- ESLint for code quality

[#83]: https://github.com/praveenc/local-llm-ui/pull/83
[#81]: https://github.com/praveenc/local-llm-ui/pull/81
[#80]: https://github.com/praveenc/local-llm-ui/pull/80
[#79]: https://github.com/praveenc/local-llm-ui/pull/79
[#78]: https://github.com/praveenc/local-llm-ui/pull/78
[#77]: https://github.com/praveenc/local-llm-ui/pull/77
[#76]: https://github.com/praveenc/local-llm-ui/pull/76
[#74]: https://github.com/praveenc/local-llm-ui/pull/74
[#73]: https://github.com/praveenc/local-llm-ui/pull/73
[#72]: https://github.com/praveenc/local-llm-ui/pull/72
[#71]: https://github.com/praveenc/local-llm-ui/pull/71
[#70]: https://github.com/praveenc/local-llm-ui/pull/70
[#69]: https://github.com/praveenc/local-llm-ui/pull/69
[#68]: https://github.com/praveenc/local-llm-ui/pull/68
[#67]: https://github.com/praveenc/local-llm-ui/pull/67
[#66]: https://github.com/praveenc/local-llm-ui/pull/66
[#65]: https://github.com/praveenc/local-llm-ui/pull/65
[#64]: https://github.com/praveenc/local-llm-ui/pull/64
[#63]: https://github.com/praveenc/local-llm-ui/pull/63
[#62]: https://github.com/praveenc/local-llm-ui/pull/62
[#61]: https://github.com/praveenc/local-llm-ui/pull/61
[#60]: https://github.com/praveenc/local-llm-ui/pull/60
[#59]: https://github.com/praveenc/local-llm-ui/pull/59
[#57]: https://github.com/praveenc/local-llm-ui/pull/57
[#56]: https://github.com/praveenc/local-llm-ui/pull/56
[#55]: https://github.com/praveenc/local-llm-ui/pull/55
[#53]: https://github.com/praveenc/local-llm-ui/pull/53
[#52]: https://github.com/praveenc/local-llm-ui/pull/52
[#51]: https://github.com/praveenc/local-llm-ui/pull/51
[#50]: https://github.com/praveenc/local-llm-ui/pull/50
[#49]: https://github.com/praveenc/local-llm-ui/pull/49
[#48]: https://github.com/praveenc/local-llm-ui/pull/48
[#47]: https://github.com/praveenc/local-llm-ui/pull/47
[#46]: https://github.com/praveenc/local-llm-ui/pull/46
[#45]: https://github.com/praveenc/local-llm-ui/pull/45
[#44]: https://github.com/praveenc/local-llm-ui/pull/44
[#43]: https://github.com/praveenc/local-llm-ui/pull/43
[#42]: https://github.com/praveenc/local-llm-ui/pull/42
[#41]: https://github.com/praveenc/local-llm-ui/pull/41
[#40]: https://github.com/praveenc/local-llm-ui/pull/40
[#39]: https://github.com/praveenc/local-llm-ui/pull/39
[#38]: https://github.com/praveenc/local-llm-ui/pull/38
[#37]: https://github.com/praveenc/local-llm-ui/pull/37
[#36]: https://github.com/praveenc/local-llm-ui/pull/36
[#35]: https://github.com/praveenc/local-llm-ui/pull/35
[#34]: https://github.com/praveenc/local-llm-ui/pull/34
[#33]: https://github.com/praveenc/local-llm-ui/pull/33
[#32]: https://github.com/praveenc/local-llm-ui/pull/32
[#31]: https://github.com/praveenc/local-llm-ui/pull/31
[#30]: https://github.com/praveenc/local-llm-ui/pull/30
[#29]: https://github.com/praveenc/local-llm-ui/pull/29
[#28]: https://github.com/praveenc/local-llm-ui/pull/28
[#27]: https://github.com/praveenc/local-llm-ui/pull/27
[#26]: https://github.com/praveenc/local-llm-ui/pull/26
[#25]: https://github.com/praveenc/local-llm-ui/pull/25
[#24]: https://github.com/praveenc/local-llm-ui/pull/24
[#23]: https://github.com/praveenc/local-llm-ui/pull/23
[#22]: https://github.com/praveenc/local-llm-ui/pull/22
[#21]: https://github.com/praveenc/local-llm-ui/pull/21
[#19]: https://github.com/praveenc/local-llm-ui/pull/19
[#16]: https://github.com/praveenc/local-llm-ui/pull/16
[Unreleased]: https://github.com/praveenc/local-llm-ui/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/praveenc/local-llm-ui/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/praveenc/local-llm-ui/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/praveenc/local-llm-ui/releases/tag/v1.0.0
