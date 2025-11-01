# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned

- **Chat History**: Persistent chat history with multiple sessions
- **Session Management**: Save, load, and manage conversation sessions
- File upload support for document analysis
- Export chat history to various formats
- Custom model parameters presets
- Keyboard shortcuts
- Search within chat history
- Code syntax highlighting improvements
- Additional AI provider support

---

## Release Notes

### Version 1.0.0

This is the first stable release of Local LLM UI. The application provides a clean, modern interface for interacting with local Large Language Models through Ollama and LM Studio.

**Key Highlights:**
- ✅ Production-ready build
- ✅ Full TypeScript support
- ✅ Comprehensive documentation
- ✅ MIT License
- ✅ Active development

[1.0.0]: https://github.com/YOUR_USERNAME/local-llm-ui/releases/tag/v1.0.0
