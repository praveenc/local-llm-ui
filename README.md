# Local LLM UI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vitejs.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A modern, responsive UI for interacting with Large Language Models (LLMs). Built with React, TypeScript, Vite, and shadcn/ui (Radix primitives + Tailwind CSS), this application provides a beautiful interface for chatting with AI models through multiple providers.

## Features

- **Modern UI**: Built with shadcn/ui components (Radix UI + Tailwind CSS) for a clean, accessible interface
- **Multiple AI Providers**: Support for Ollama, LM Studio, Amazon Bedrock, Bedrock Mantle, Groq, and Cerebras
- **Real-time Streaming**: Stream responses from AI models in real-time with smooth animations
- **Reasoning/Thinking Support**: Display thinking process for reasoning models (MiniMax, DeepSeek-R1, NemoTron, etc.)
- **Unified Model Selector**: Searchable model picker in chat input, grouped by provider
- **Inference Settings**: Adjust temperature, top-p, and max tokens via popover in chat input
- **Context Window Indicator**: Track token usage against model context limits
- **Prompt Optimizer**: Optimize prompts for Claude 4.5 models using best practices (Bedrock only)
- **Document Upload**: Upload documents (PDF, TXT, HTML, MD, CSV, DOC, DOCX, XLS, XLSX) with Bedrock models
- **Usage Metrics**: View token usage and latency displayed after each AI response
- **Chat History**: Manage multiple chat sessions with automatic history tracking via IndexedDB
- **Saved Prompts**: Save and reuse frequently used prompts
- **User Preferences**: Persistent settings for preferred AI provider and custom avatar initials
- **Dark/Light Mode**: Toggle between visual modes
- **Responsive Design**: Works seamlessly across desktop and mobile devices

## Prerequisites

Before running this application, ensure you have the following installed:

- **Node.js**: Version 18.x or higher
- **npm**: Version 9.x or higher (comes with Node.js)
- **AI Provider** (at least one):
  - [Ollama](https://ollama.ai) - Local AI models
  - [LM Studio](https://lmstudio.ai) - Local AI platform with model management
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

### Option 4: Bedrock Mantle

Bedrock Mantle provides an OpenAI-compatible endpoint for Bedrock models.

1. Configure in the app's Preferences:
   - Set your Mantle API key
   - Set your Mantle region

### Option 5: Groq

1. Get an API key from [console.groq.com](https://console.groq.com)

2. Configure in the app's Preferences:
   - Enter your Groq API key

### Option 6: Cerebras

1. Get an API key from [cloud.cerebras.ai](https://cloud.cerebras.ai)

2. Configure in the app's Preferences:
   - Enter your Cerebras API key

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

3. **Start Chatting**:
   - Type your message in the input field
   - Press Enter or click the send button
   - Watch the AI response stream in real-time

### Model Configuration

Adjust model parameters via the settings icon in the chat input:

- **Temperature** (0.0 - 1.0): Controls randomness
  - Lower values (0.1-0.3): More focused and deterministic
  - Higher values (0.7-1.0): More creative and varied

- **Top P** (0.0 - 1.0): Controls diversity via nucleus sampling

- **Max Tokens**: Maximum length of the response

> **Note for Claude 4.5 Models**: Claude 4.5 models don't support both temperature and topP simultaneously. The UI provides a toggle to choose which parameter to use.

### Reasoning Models

When using reasoning/thinking models (MiniMax, DeepSeek-R1, NemoTron, etc.):

- A collapsible "Thinking" section appears showing the model's reasoning process
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
│   ├── bedrock-aisdk-proxy.ts # Bedrock AI SDK proxy
│   ├── bedrock-proxy.ts       # Bedrock models proxy
│   ├── lmstudio-aisdk-proxy.ts # LM Studio chat proxy
│   ├── lmstudio-proxy.ts      # LM Studio SDK proxy
│   └── mantle-proxy.ts        # Bedrock Mantle proxy
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
- `/api/mantle` → Bedrock Mantle proxy
- `/api/aisdk` → Groq/Cerebras proxy
- `/api/lmstudio-sdk`, `/api/lmstudio-aisdk` → LM Studio proxies

## Troubleshooting

### No Models Available

**Problem**: The model selector shows no models

**Solutions**:

- **Ollama**: Ensure Ollama is running and you've pulled at least one model
- **LM Studio**: Ensure the server is running on port 1234
- **Bedrock**: Verify AWS credentials and model access
- **Groq/Cerebras**: Check API key in Preferences

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
- **TypeScript 5.9**: Type safety
- **Vite 7**: Build tool and dev server
- **shadcn/ui**: UI component library (Radix UI + Tailwind CSS)
- **Tailwind CSS 4**: Utility-first CSS
- **Dexie.js**: IndexedDB wrapper for persistence
- **AI SDK**: Vercel AI SDK for streaming (@ai-sdk/amazon-bedrock, @ai-sdk/openai-compatible, etc.)
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
- Supports [Ollama](https://ollama.ai), [LM Studio](https://lmstudio.ai), [Amazon Bedrock](https://aws.amazon.com/bedrock/), [Groq](https://groq.com), and [Cerebras](https://cerebras.ai)
- Powered by [Vite](https://vitejs.dev/), [React](https://react.dev/), and [Vercel AI SDK](https://sdk.vercel.ai/)
