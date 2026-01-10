.PHONY: dev build lint lint-fix format test test-run test-ui clean help

# Development
dev:
	npm run dev

# Build
build:
	npm run build

# Linting
lint:
	npm run lint

lint-fix:
	npm run lint:fix

# Formatting
format:
	npm run format

# Testing
test:
	npm run test

test-run:
	npm run test:run

test-ui:
	npm run test:ui

# Combined commands
check: lint test-run
	@echo "All checks passed"

fix: format lint-fix
	@echo "Formatting and linting fixes applied"

# Clean
clean:
	rm -rf dist node_modules/.cache

# Help
help:
	@echo "Available targets:"
	@echo "  dev       - Start development server"
	@echo "  build     - Build for production"
	@echo "  lint      - Run ESLint"
	@echo "  lint-fix  - Run ESLint with auto-fix"
	@echo "  format    - Run Prettier"
	@echo "  test      - Run tests in watch mode"
	@echo "  test-run  - Run tests once"
	@echo "  test-ui   - Run tests with UI"
	@echo "  check     - Run lint and tests"
	@echo "  fix       - Run format and lint-fix"
	@echo "  clean     - Remove build artifacts"
	@echo "  help      - Show this help"
