# Local LLM UI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vitejs.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A modern, responsive UI for interacting with Large Language Models (LLMs). Built with React, TypeScript, Vite, and shadcn/ui (Radix primitives + Tailwind CSS), this application provides a beautiful interface for chatting with AI models through multiple providers.

![Local LLM UI](.github/images/local-llm-ui-ex1.png)

## Features

- **Modern UI**: Built with shadcn/ui components (Radix UI + Tailwind CSS) for a clean, accessible interface
- **Multiple AI Providers**: Support for Ollama, LM Studio, Amazon Bedrock, Bedrock Mantle, Anthropic, Groq, and Cerebras
- **MCP Server Integration**: Connect external tools via [Model Context Protocol](https://modelcontextprotocol.io/) — stdio, HTTP, and SSE transports
- **Web Search**: Let the model search the web with Brave Search, Exa, or Tavily. All three have a free monthly plan. If one provider runs out of quota, the app can use the next one. Add keys in **Preferences → Web Search**
- **Real-time Streaming**: Stream responses from AI models in real-time with smooth animations
- **Reasoning/Thinking Support**: Display thinking process for reasoning models (MiniMax, DeepSeek-R1, NemoTron, etc.)
- **Thinking Effort**: Choose how much a Claude or OpenAI reasoning model thinks before it answers, from Off to XHigh
- **Unified Model Selector**: Searchable model picker in chat input, grouped by provider with unavailable services clearly flagged
- **Inference Settings**: Adjust temperature, top-p, max tokens, and max tool steps via popover in chat input (only the settings the selected model accepts)
- **Context Window Indicator**: Track token usage against model context limits
- **Prompt Optimizer**: Optimize prompts for Claude 4.5 models using best practices (Bedrock only)
- **Document Upload**: Upload documents (PDF, TXT, HTML, MD, CSV, DOC, DOCX, XLS, XLSX) with Bedrock models
- **Usage Metrics**: View token usage and latency displayed after each AI response
- **Chat History**: Manage multiple chat sessions with automatic history tracking via IndexedDB
- **Quote and Ask**: Select text in a reply to ask about it in this chat, or in a new forked chat
- **Saved Prompts**: Save and reuse frequently used prompts
- **User Preferences**: Choose a default provider and its default thinking effort. Add API keys in the same list, and set avatar initials, theme, and density
- **Remembers Your Model**: New conversations start with the model you last picked, also after a page reload
- **Dark/Light Mode**: Toggle between visual modes
- **Color Themes**: Pick Cosmic Night, [Cobaltz](https://github.com/praveenc/cobaltz), or [Rosé Pine](https://rosepinetheme.com/palette/). Each theme has a light and a dark variant
- **Responsive Design**: Works seamlessly across desktop and mobile devices

## MCP Server Support

Connect external tools to your LLM conversations via the [Model Context Protocol](https://modelcontextprotocol.io/). Configure servers in **Preferences → MCP Servers** with support for local (stdio) and remote (HTTP/SSE) transports.

| MCP Tools Status | MCP Server Configuration |
|:---:|:---:|
| ![](.github/images/local-llm-mcp-servers-support_1.png) | ![](.github/images/local-llm-mcp-servers-support_2.png) |

- **Toolbar indicator** shows connected servers and available tools at a glance
- **Security hardened** — command allowlists, SSRF protection, env var isolation ([details](docs/SECURITY-LEARNINGS.md))

## Prerequisites

Before running this application, ensure you have the following installed:

- **Node.js**: Version 22.12 or higher
- **npm**: Version 9.x or higher (comes with Node.js)
- **AI Provider** (at least one):
  - [Ollama](https://ollama.ai) - Local AI models
  - [LM Studio](https://lmstudio.ai) - Local AI platform with model management
  - [Anthropic](https://anthropic.com) - Claude models (requires API key)
  - [Amazon Bedrock](https://aws.amazon.com/bedrock/) - AWS cloud AI service (requires AWS credentials)
  - [Bedrock Mantle](https://aws.amazon.com/bedrock/) - OpenAI-compatible Bedrock endpoint
  - [Groq](https://groq.com) - Fast cloud inference (requires API key)
  - [Cerebras](https://cerebras.ai) - Cloud inference (requires API key)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/praveenc/local-llm-ui.git
   cd local-llm-ui
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

## AI Provider Setup

### Option 1: Ollama

1. Download and install Ollama from [ollama.com](https://ollama.com)

2. Pull a model (e.g., qwen3-8b):

   ```bash
   ollama pull qwen3-8b-8k:latest
   ```

3. Verify Ollama is running:

   ```bash
   ollama list
   ```

   Ollama runs on `http://localhost:11434` by default.

### Option 2: LM Studio

1. Download and install LM Studio from [lmstudio.ai](https://lmstudio.ai)

2. Download a model through the LM Studio interface

3. Start the local server:
   - Open LM Studio
   - Go to the "Developer" or "Server" tab
   - Click "Start Server"
   - Ensure it's running on port `1234`

4. (Optional) Enable JIT Loading:
   - Go to Developer → Server Settings
   - Enable "JIT Loading" to load models on-demand

### Option 3: Amazon Bedrock

1. **Set up AWS credentials** using one of these methods:

   **Option A: Environment Variables**

   ```bash
   export AWS_ACCESS_KEY_ID=your_access_key_id
   export AWS_SECRET_ACCESS_KEY=your_secret_access_key
   export AWS_REGION=us-west-2  # or your preferred region
   ```

   **Option B: AWS CLI**

   ```bash
   aws configure
   ```

   **Option C: AWS Credentials File**
   Create `~/.aws/credentials`:

   ```ini
   [default]
   aws_access_key_id = your_access_key_id
   aws_secret_access_key = your_secret_access_key
   ```

2. **Ensure IAM Permissions**: Your AWS user/role needs these permissions:
   - `bedrock:ListInferenceProfiles`
   - `bedrock:InvokeModel` or `bedrock:InvokeModelWithResponseStream`

3. **Request Model Access** (if needed):
   - Go to AWS Bedrock console
   - Navigate to "Model access"
   - Request access to desired models (e.g., Claude, Llama)

### Option 4: Anthropic

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)

2. In **Preferences → Providers**, select **Add key** next to Anthropic and paste the key

### Option 5: Bedrock Mantle

Bedrock Mantle provides an OpenAI-compatible endpoint for Bedrock models.

1. In **Preferences → Providers**, select **Add key** next to Bedrock Mantle
2. Paste the API key and select the region

### Option 6: Groq

1. Get an API key from [console.groq.com](https://console.groq.com)

2. In **Preferences → Providers**, select **Add key** next to Groq and paste the key

### Option 7: Cerebras

1. Get an API key from [cloud.cerebras.ai](https://cloud.cerebras.ai)

2. In **Preferences → Providers**, select **Add key** next to Cerebras and paste the key

## Web Search Setup

The globe button in the chat input lets the model search the web. It needs an API key for at least one of these providers:

| Provider | Free plan | Credit card | Get a key |
|---|---|---|---|
| Brave Search | $5 credit each month, about 1,000 searches | Required | [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com/app/keys) |
| Exa | $10 credit each month, about 1,400 searches | Not required | [dashboard.exa.ai](https://dashboard.exa.ai/api-keys) |
| Tavily | 1,000 searches each month | Not required | [app.tavily.com](https://app.tavily.com) |

Free plans change. Check each provider's pricing page for the current limits.

1. In **Preferences → Web Search**, select **Add key** next to a provider and paste the key.
2. Select the **primary provider**. The app tries this provider first.
3. Keep **Use the next provider when one fails** on to get more free searches. When the primary provider has no quota left, is rate limited, or does not respond, the app tries the next provider that has a key.

The search card in the reply shows which provider returned the results.

### Max Tool Steps

With web search or MCP tools on, the model can call tools several times before it answers. Each model call is one step. Set **Max Tool Steps** (2 to 25, default 10) in the chat input settings. The last step always writes the answer, so the model uses tools in at most one step less than the limit. Increase the value when a question needs many searches or page fetches. The app keeps your value after a page reload.

## Running the Application

### Development Mode

Start the development server with hot module replacement:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Production Build

Build the application for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Usage

### Getting Started

1. **Start the Application**: Run `npm run dev`

2. **Select a Model**:
   - Click the model selector button in the chat input
   - Browse models grouped by provider
   - Use the search to filter models
   - If a provider is unavailable, the selector shows a brief setup or connection hint

3. **Start Chatting**:
   - Type your message in the input field
   - Press Enter or click the send button
   - Watch the AI response stream in real-time

### Chat Input

The chat input has two groups of controls below the text box.

- **Left**: add files (**+**), the model, and the thinking effort. These set what the model gets and which model answers.
- **Right**: web search, MCP tools, and inference settings. After the first message, the right group also shows **Clear chat** and the context usage. The send button is last. While a reply streams, the send button becomes a stop button.

When web search or MCP tools are on, their buttons show in the theme color.

### Color Themes

To change the theme, click the palette button in the header and select a theme, or open **Preferences → Display** and select a card under **Color theme**. The same menu also selects Light or Dark. The sun and moon button next to it switches between the light and dark variants with one click.

| Theme | Light variant | Dark variant |
|---|---|---|
| Cosmic Night (default) | Light | Dark |
| [Cobaltz](https://github.com/praveenc/cobaltz) | Cobaltz Light, with a blue accent | Cobaltz, deep cobalt with a gold accent |
| [Rosé Pine](https://rosepinetheme.com/palette/) | Rosé Pine Dawn, with a pine accent | Rosé Pine, with a rose accent |

The app keeps your theme in the browser, with your other preferences.

Code blocks in replies use the syntax colors of the theme:

| Theme | Code colors (light / dark) |
|---|---|
| Cosmic Night | One Light / One Dark Pro |
| Cobaltz | Cobaltz Light / Cobaltz, from the Cobaltz VS Code theme |
| Rosé Pine | Rosé Pine Dawn / Rosé Pine |

The syntax highlighter loads when the first code block shows, not when the page loads.

### Model Configuration

Adjust model parameters via the settings icon in the chat input:

- **Temperature** (0.0 - 1.0): Controls randomness
  - Lower values (0.1-0.3): More focused and deterministic
  - Higher values (0.7-1.0): More creative and varied

- **Top P** (0.0 - 1.0): Controls diversity via nucleus sampling

- **Max Tokens**: Maximum length of the response

The settings panel shows only the controls that the selected model accepts:

| Model | Temperature and Top P |
|---|---|
| Claude 4.7 and later (all Claude 5.x models) | Not shown. These models reject both settings. |
| Claude 4.0 to 4.6 | A toggle. You can set one of the two. |
| Claude 3.x and non-Claude models | Both are shown. |

The app also leaves out any setting the model does not accept when it sends the request.

### Thinking Effort

For models that can think before they answer, a **Thinking** button shows next to the model selector. Click it and choose a level:

| Level | What the app sends |
|---|---|
| Default | Nothing. The model uses its own setting. |
| Off | Thinking off. Some models cannot turn thinking off. These models use their lowest level. |
| Minimal, Low, Medium, High, XHigh | That level. If the model does not have the level, the app uses the nearest level that the model has. |

The button shows for these models:

| Provider | Models |
|---|---|
| Amazon Bedrock | Claude 4 and later, OpenAI GPT-5 and later, Amazon Nova 2 |
| Bedrock Mantle | gpt-oss, Kimi K2 Thinking, Kimi K2.5, DeepSeek V3.x, GLM, Qwen3 32B, Qwen3 Next, Nemotron 3 |
| Anthropic | Claude 4 and later |
| OpenRouter | Claude 4 and later, OpenAI reasoning models |
| Groq | gpt-oss |
| Ollama | Models that Ollama lists with the "thinking" capability (Ollama 0.6 or later) |

Some models have fewer levels:

- **On/off models** (Qwen3 on Ollama; DeepSeek, GLM, Qwen3, Kimi K2.5, and Nemotron on Mantle): **Off** turns thinking off. All other levels turn it on.
- **gpt-oss** (Ollama and Mantle) and **Kimi K2 Thinking** cannot turn thinking off. **Off** uses their lowest level, Low.

On Amazon Bedrock and Bedrock Mantle, the app does not send Temperature or Top P when thinking is on, because reasoning models do not accept them.

To set the level that each provider starts with, open **Preferences → Providers**. Select the provider, then set **Default thinking**. When you change to a model from a different provider, the button changes to that provider's default.

### Model Memory

The app remembers the model that you last picked in the chat input. New conversations start with this model, also after a page reload. If the model is not available, the app uses the last model from your default provider. When you change the default provider in Preferences, new conversations start with that provider's models again.

### Quote and Ask

You can ask a question about one part of a reply:

1. Select text in a message. A **Quote and Ask** button shows above the selection.
2. Click the button and type your question.
3. Choose where to send it:
   - **Send to Compose** puts the quote and your question in the message box. You can edit the text before you send it.
   - **Send to Fork** makes a new chat with the messages up to the quoted one, then sends your question there. The original chat does not change.

The quote goes to the model in a `<quote>` tag, before your question:

```
<quote>
selected text
</quote>

your question
```

The chat shows the quote as an indented block. **Send to Fork** needs a selected model.

### Reasoning Models

When using reasoning/thinking models (Claude, Nova 2, MiniMax, DeepSeek-R1, NemoTron, etc.):

- A collapsible "Thinking" section appears showing the model's reasoning process
- OpenAI models do not return their reasoning text. Only the output token count shows that they thought
- Click to expand/collapse the reasoning content
- Reasoning is persisted with the conversation

### Document Upload (Bedrock Only)

When using Amazon Bedrock models:

1. Click the + button in the chat input
2. Select "Add photos or files"
3. Choose files (max 4.5 MB each)
4. Supported formats: PDF, TXT, HTML, MD, CSV, DOC, DOCX, XLS, XLSX, images
5. Send your message with the attached documents

### Context Window

The context indicator in the chat input shows:
- Current token usage vs model's context limit
- Hover for detailed breakdown (input/output tokens)

### Saved Prompts

Save frequently used prompts:
1. Open the Saved Prompts panel from the sidebar
2. Create new prompts with categories
3. Click to insert saved prompts into the chat input

## Project Structure

```text
local-llm-ui/
├── src/
│   ├── components/
│   │   ├── ai-elements/       # AI UI components (conversation, message, prompt-input, reasoning, context)
│   │   ├── chat/              # Chat container and related components
│   │   ├── layout/            # Layout components
│   │   ├── prompts/           # Saved prompts components
│   │   ├── sidebar/           # Sidebar components
│   │   ├── shared/            # Shared components
│   │   └── ui/                # shadcn/ui components
│   ├── db/                    # Dexie.js database schema
│   ├── hooks/                 # React hooks
│   ├── layout/                # App shell and layout
│   ├── services/              # API services for each provider
│   ├── types/                 # TypeScript types
│   ├── utils/                 # Utility functions
│   └── main.tsx               # Application entry point
├── server/
│   ├── aisdk-proxy.ts         # Groq/Cerebras proxy
│   ├── anthropic-aisdk-proxy.ts # Anthropic proxy
│   ├── bedrock-aisdk-proxy.ts # Bedrock AI SDK proxy
│   ├── bedrock-proxy.ts       # Bedrock models proxy
│   ├── lmstudio-aisdk-proxy.ts # LM Studio chat proxy
│   ├── lmstudio-proxy.ts      # LM Studio SDK proxy
│   ├── mantle-proxy.ts        # Bedrock Mantle proxy
│   ├── mcp-manager.ts         # MCP client lifecycle and tools
│   ├── ollama-aisdk-proxy.ts  # Ollama proxy
│   └── security.ts            # Shared security utilities
├── public/                    # Static assets
├── vite.config.ts             # Vite configuration with proxy middleware
└── package.json               # Dependencies and scripts
```

## Configuration

### Environment Variables

Create a `.env` file for custom configuration (optional):

```env
# AWS Configuration (if not using AWS CLI or credentials file)
AWS_REGION=us-west-2
# AWS_ACCESS_KEY_ID=your_access_key_id
# AWS_SECRET_ACCESS_KEY=your_secret_access_key
```

### Proxy Configuration

The Vite development server proxies requests to AI services:

- `/api/ollama` → `http://localhost:11434`
- `/api/lmstudio` → `http://localhost:1234`
- `/api/bedrock`, `/api/bedrock-aisdk` → Server-side AWS SDK proxy
- `/api/anthropic` → Anthropic Claude proxy
- `/api/mantle` → Bedrock Mantle proxy
- `/api/aisdk` → Groq/Cerebras proxy
- `/api/lmstudio-sdk`, `/api/lmstudio-aisdk` → LM Studio proxies

## Troubleshooting

### No Models Available

**Problem**: The model selector shows no models

**Solutions**:

- Check the unavailable provider messages shown in the model selector for the exact issue
- **Ollama**: Ensure Ollama is running and you've pulled at least one model
- **LM Studio**: Start LM Studio, enable its local server, and ensure it's running on port 1234
- **Bedrock**: Configure AWS credentials in your environment and verify model access/IAM permissions
- **Groq/Cerebras/Anthropic/OpenRouter/Bedrock Mantle**: Check the API key in **Preferences → Providers**. A provider without a key cannot be the default provider

### Connection Failed

**Problem**: "Cannot connect" error messages

**Solutions**:

- Verify the AI service is running on the correct port
- Check firewall settings
- For cloud providers, verify API keys are configured correctly

### Reasoning Not Showing

**Problem**: Thinking/reasoning content not displayed

**Solutions**:

- Ensure you're using a reasoning model (MiniMax, DeepSeek-R1, NemoTron, etc.)
- Check that the model outputs reasoning in a supported format

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format with Prettier
- `npm run test` - Run tests in watch mode
- `npm run test:run` - Run tests once

### Code Style

This project uses:

- **ESLint**: For code linting
- **Prettier**: For code formatting
- **TypeScript**: For type safety
- **Husky**: Pre-commit hooks for lint-staged

## Technologies Used

- **React 19**: UI framework
- **TypeScript 6.0**: Type safety
- **Vite 8**: Build tool and dev server
- **shadcn/ui**: UI component library (Radix UI + Tailwind CSS)
- **Tailwind CSS 4**: Utility-first CSS
- **Dexie.js**: IndexedDB wrapper for persistence
- **TanStack Query**: Data fetching and caching for provider-backed UI state
- **AI SDK**: Vercel AI SDK for streaming (@ai-sdk/amazon-bedrock, @ai-sdk/anthropic, @ai-sdk/groq, @ai-sdk/cerebras, @ai-sdk/openai-compatible, @ai-sdk/mcp)
- **MCP SDK**: @modelcontextprotocol/sdk for MCP server connectivity
- **Streamdown**: Markdown rendering in chat
- **Lucide React**: Icons

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For issues or questions:

1. Check the troubleshooting section
2. Verify your AI provider is properly configured
3. Check the browser console for error messages
4. Open an issue on GitHub

## Acknowledgments

- UI built with [shadcn/ui](https://ui.shadcn.com/) and [Radix UI](https://www.radix-ui.com/)
- Supports [Ollama](https://ollama.ai), [LM Studio](https://lmstudio.ai), [Amazon Bedrock](https://aws.amazon.com/bedrock/), [Anthropic](https://anthropic.com), [Groq](https://groq.com), and [Cerebras](https://cerebras.ai)
- Powered by [Vite](https://vitejs.dev/), [React](https://react.dev/), and [Vercel AI SDK](https://sdk.vercel.ai/)
