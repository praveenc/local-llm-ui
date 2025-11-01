# Contributing to Local LLM UI

Thank you for your interest in contributing to Local LLM UI! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project follows a Code of Conduct that all contributors are expected to adhere to. Please be respectful and constructive in all interactions.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/local-llm-ui.git`
3. Add upstream remote: `git remote add upstream https://github.com/ORIGINAL_OWNER/local-llm-ui.git`
4. Create a new branch: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher
- Ollama or LM Studio installed locally

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run linter
npm run lint

# Build for production
npm run build
```

### Project Structure

```
local-llm-ui/
├── src/
│   ├── components/     # React components
│   ├── layout/         # Layout components
│   ├── services/       # API services (Ollama, LM Studio)
│   ├── utils/          # Utility functions
│   └── main.tsx        # Entry point
├── public/             # Static assets
└── server/             # Server-side code (disabled)
```

## How to Contribute

### Types of Contributions

We welcome various types of contributions:

- 🐛 **Bug fixes**
- ✨ **New features**
- 📝 **Documentation improvements**
- 🎨 **UI/UX enhancements**
- ♿ **Accessibility improvements**
- 🌐 **Internationalization**
- ✅ **Tests**
- 🔧 **Configuration improvements**

### Before You Start

1. Check existing [issues](https://github.com/YOUR_USERNAME/local-llm-ui/issues) and [pull requests](https://github.com/YOUR_USERNAME/local-llm-ui/pulls)
2. For major changes, open an issue first to discuss your proposal
3. Make sure you can build and run the project locally

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Define proper types and interfaces
- Avoid `any` types when possible
- Use type imports: `import type { Type } from 'module'`

### React

- Use functional components with hooks
- Follow React best practices
- Use proper prop types
- Implement proper error boundaries where needed

### Cloudscape Components

- Use Cloudscape Design System components
- Follow Cloudscape patterns and guidelines
- Use design tokens for styling
- Maintain accessibility standards

### Code Style

- Follow the existing code style
- Use meaningful variable and function names
- Write self-documenting code
- Add comments for complex logic
- Keep functions small and focused

### File Organization

- One component per file
- Co-locate related files
- Use index files for clean imports
- Follow the existing directory structure

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification:

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

### Examples

```bash
feat(chat): add file upload support
fix(ollama): handle connection timeout errors
docs(readme): update installation instructions
style(components): format code with prettier
refactor(services): simplify API service structure
test(chat): add unit tests for message handling
chore(deps): update dependencies
```

### Commit Message Guidelines

- Use present tense ("add feature" not "added feature")
- Use imperative mood ("move cursor to..." not "moves cursor to...")
- Keep the subject line under 72 characters
- Reference issues and pull requests when relevant
- Provide detailed description in the body for complex changes

## Pull Request Process

### Before Submitting

1. ✅ Update your branch with the latest upstream changes
2. ✅ Run `npm run lint` and fix any issues
3. ✅ Run `npm run build` to ensure it builds successfully
4. ✅ Test your changes thoroughly
5. ✅ Update documentation if needed
6. ✅ Add or update tests if applicable

### Submitting a Pull Request

1. Push your changes to your fork
2. Open a pull request against the `main` branch
3. Fill out the pull request template completely
4. Link related issues using keywords (e.g., "Fixes #123")
5. Request review from maintainers

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added/updated
- [ ] All tests pass
```

### Review Process

- Maintainers will review your PR
- Address any requested changes
- Once approved, a maintainer will merge your PR
- Your contribution will be included in the next release

## Reporting Bugs

### Before Reporting

1. Check if the bug has already been reported
2. Verify it's reproducible in the latest version
3. Collect relevant information

### Bug Report Template

```markdown
**Describe the bug**
Clear description of the bug

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen

**Screenshots**
If applicable, add screenshots

**Environment:**
- OS: [e.g., macOS 14.0]
- Browser: [e.g., Chrome 120]
- Node version: [e.g., 18.17.0]
- AI Provider: [e.g., Ollama 0.1.17]

**Additional context**
Any other relevant information
```

## Suggesting Features

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
Clear description of the problem

**Describe the solution you'd like**
Clear description of what you want to happen

**Describe alternatives you've considered**
Alternative solutions or features

**Additional context**
Mockups, examples, or other context
```

## Development Tips

### Running with Different Providers

```bash
# Ensure Ollama is running
ollama list

# Or ensure LM Studio server is running on port 1234
```

### Debugging

- Use browser DevTools for frontend debugging
- Check console for errors
- Use React DevTools for component inspection
- Check Network tab for API calls

### Testing Locally

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm run preview
```

## Questions?

If you have questions:

1. Check existing documentation
2. Search closed issues
3. Open a new issue with the "question" label
4. Join discussions in the repository

## Recognition

Contributors will be recognized in:
- README.md acknowledgments
- Release notes
- GitHub contributors page

Thank you for contributing to Local LLM UI! 🎉
