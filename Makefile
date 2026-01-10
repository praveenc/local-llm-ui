.PHONY: dev build lint lint-fix format test test-run test-ui check fix clean help

# Quiet mode - only show last N lines or errors
TAIL_LINES ?= 10

# Development (interactive - no suppression)
dev:
	npm run dev

# Build - show last lines (includes errors)
build:
	@npm run build 2>&1 | tail -n $(TAIL_LINES) || (npm run build; exit 1)

# Linting - show last lines
lint:
	@npm run lint 2>&1 | tail -n $(TAIL_LINES) || (npm run lint; exit 1)

lint-fix:
	@npm run lint:fix 2>&1 | tail -n $(TAIL_LINES) || (npm run lint:fix; exit 1)

# Formatting - show summary only
format:
	@OUTPUT=$$(npm run format 2>&1); \
	CHANGED=$$(echo "$$OUTPUT" | grep -c '(changed)' || true); \
	UNCHANGED=$$(echo "$$OUTPUT" | grep -c '(unchanged)' || true); \
	echo "✓ Formatted: $$CHANGED changed, $$UNCHANGED unchanged"

# Testing - show summary
test-run:
	@npm run test:run 2>&1 | grep -E '(✓|✗|FAIL|PASS|Error|error|Tests|Duration)' | tail -n $(TAIL_LINES) || (npm run test:run; exit 1)

test:
	npm run test

test-ui:
	npm run test:ui

# Combined commands - quiet with summary
check:
	@echo "Running lint..."
	@npm run lint 2>&1 | tail -n 5
	@echo "Running tests..."
	@npm run test:run 2>&1 | grep -E '(✓|✗|FAIL|PASS|Test Files|Tests|Duration)' | tail -n 5
	@echo "✓ All checks passed"

fix:
	@echo "Formatting..."
	@npm run format 2>&1 | grep -c 'changed\|unchanged' | xargs -I {} echo "  {} files processed"
	@echo "Fixing lint issues..."
	@npm run lint:fix 2>&1 | tail -n 3
	@echo "✓ Fixes applied"

# Clean
clean:
	@rm -rf dist node_modules/.cache
	@echo "✓ Cleaned"

# Help
help:
	@echo "Available targets:"
	@echo "  dev       - Start development server"
	@echo "  build     - Build for production"
	@echo "  lint      - Run ESLint (quiet)"
	@echo "  lint-fix  - Run ESLint with auto-fix (quiet)"
	@echo "  format    - Run Prettier (quiet)"
	@echo "  test      - Run tests in watch mode"
	@echo "  test-run  - Run tests once (quiet)"
	@echo "  test-ui   - Run tests with UI"
	@echo "  check     - Run lint and tests (quiet)"
	@echo "  fix       - Run format and lint-fix (quiet)"
	@echo "  clean     - Remove build artifacts"
	@echo "  help      - Show this help"
	@echo ""
	@echo "Set TAIL_LINES=N to adjust output (default: 10)"
