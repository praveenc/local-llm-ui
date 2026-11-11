# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Everything after 1.0.0 is on `main` without a release tag. PR numbers link to GitHub.

### 2026-11

#### Added

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

- Stream errors from the Anthropic, Ollama, and LM Studio proxies now show in the chat; before, the reply stopped with no message ([#49])
- A Bedrock error after the stream started no longer stops the dev server ([#45])
- LM Studio model list fallback now runs; Mantle region list has all 12 regions ([#49])

#### Removed

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
[1.0.0]: https://github.com/praveenc/local-llm-ui/releases/tag/v1.0.0
