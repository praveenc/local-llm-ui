# Chat Vite Cloudscape

A modern, responsive chat application built with React, TypeScript, Vite, and AWS Cloudscape Design System. This application provides a beautiful interface for interacting with local AI models through Ollama or LM Studio.

## Features

- **Modern UI**: Built with AWS Cloudscape Design System for a professional, accessible interface
- **Multiple AI Providers**: Support for Ollama and LM Studio
- **Real-time Streaming**: Stream responses from AI models in real-time
- **Model Configuration**: Adjust temperature, top-p, and max tokens for fine-tuned responses
- **Chat History**: Manage multiple chat sessions with automatic history tracking
- **Responsive Design**: Works seamlessly across desktop and mobile devices
- **Dark/Light Mode**: Automatic theme support through Cloudscape

## Prerequisites

Before running this application, ensure you have the following installed:

- **Node.js**: Version 18.x or higher
- **npm**: Version 9.x or higher (comes with Node.js)
- **AI Provider** (at least one):
  - [Ollama](https://ollama.ai) - Local AI models (recommended)
  - [LM Studio](https://lmstudio.ai) - Alternative local AI platform

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd chat-vite-cloudscape
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

## AI Provider Setup

### Option 1: Ollama (Recommended)

1. Download and install Ollama from [ollama.ai](https://ollama.ai)

2. Pull a model (e.g., llama2):

   ```bash
   ollama pull llama2
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

2. **Select AI Provider**:
   - Open the sidebar (Model Settings)
   - Choose between Ollama or LM Studio
   - The app will automatically detect available models

3. **Select a Model**:
   - Choose from the dropdown list of available models
   - Models are filtered to show only chat-capable models

4. **Start Chatting**:
   - Type your message in the input field
   - Press Enter or click the send button
   - Watch the AI response stream in real-time

### Model Configuration

Adjust model parameters in the expandable settings panel:

- **Temperature** (0.0 - 2.0): Controls randomness
  - Lower values (0.1-0.5): More focused and deterministic
  - Higher values (0.8-1.5): More creative and varied

- **Top P** (0.0 - 1.0): Controls diversity via nucleus sampling
  - Lower values: More focused responses
  - Higher values: More diverse responses

- **Max Tokens**: Maximum length of the response
  - Default: 4096 tokens
  - Adjust based on your needs and model capabilities

### Managing Chats

- **New Chat**: Click the "New Chat" button in the sidebar to start fresh
- **Clear History**: Clears the current conversation while keeping the session

## Project Structure

```text
chat-vite-cloudscape/
├── src/
│   ├── components/
│   │   ├── chat/              # Chat-related components
│   │   │   ├── ChatContainer.tsx
│   │   │   ├── ChatInputPanel.tsx
│   │   │   ├── MessageList.tsx
│   │   │   └── ...
│   │   └── layout/            # Layout components
│   ├── layout/
│   │   ├── BaseAppLayout.tsx  # Main app layout
│   │   └── SideBar.tsx        # Model settings sidebar
│   ├── services/
│   │   ├── api.ts             # API service orchestrator
│   │   ├── ollama.ts          # Ollama integration
│   │   ├── lmstudio.ts        # LM Studio integration
│   │   └── types.ts           # TypeScript types
│   ├── utils/                 # Utility functions
│   └── main.tsx               # Application entry point
├── server/                    # Server-side code (disabled)
├── public/                    # Static assets
├── vite.config.ts             # Vite configuration
└── package.json               # Dependencies and scripts
```

## Configuration

### Environment Variables

The application uses Vite's environment variable system. Create a `.env` file in the root directory if you need custom configuration:

```env
# Optional: Custom Ollama URL
VITE_OLLAMA_URL=http://localhost:11434

# Optional: Custom LM Studio URL
VITE_LMSTUDIO_URL=http://localhost:1234
```

### Proxy Configuration

The Vite development server proxies requests to local AI services:

- `/api/ollama` → `http://localhost:11434`
- `/api/lmstudio` → `http://localhost:1234`

This configuration is in `vite.config.ts` and handles CORS automatically.

## Troubleshooting

### No Models Available

**Problem**: The model dropdown is empty

**Solutions**:

- **Ollama**: Ensure Ollama is running and you've pulled at least one model
  
  ```bash
  ollama list
  ollama pull llama2
  ```

- **LM Studio**: Ensure the server is running and a model is loaded or JIT Loading is enabled

### Connection Failed

**Problem**: "Cannot connect" error messages

**Solutions**:

- Verify the AI service is running on the correct port
- Check firewall settings
- Ensure no other application is using the port
- Restart the AI service

### Slow Responses

**Problem**: AI responses are very slow

**Solutions**:

- Use a smaller model (e.g., `llama2:7b` instead of `llama2:70b`)
- Reduce `max_tokens` setting
- Ensure your system meets the model's hardware requirements
- Close other resource-intensive applications

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Code Style

This project uses:

- **ESLint**: For code linting
- **TypeScript**: For type safety
- **Cloudscape Design System**: For UI components

### Adding New Features

1. Follow the existing component structure
2. Use Cloudscape components for consistency
3. Maintain TypeScript types
4. Test with both Ollama and LM Studio

## Technologies Used

- **React 19**: UI framework
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server
- **Cloudscape Design System**: AWS UI component library
- **React Markdown**: Markdown rendering in chat

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For issues or questions:

1. Check the troubleshooting section
2. Verify your AI provider is properly configured
3. Check the browser console for error messages
4. Ensure all dependencies are installed correctly

## Acknowledgments

- Built with [AWS Cloudscape Design System](https://cloudscape.design/)
- Powered by [Ollama](https://ollama.ai) and [LM Studio](https://lmstudio.ai)
- Created with [Vite](https://vitejs.dev/)
